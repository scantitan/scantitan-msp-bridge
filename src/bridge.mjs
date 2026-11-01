import {insist, BridgeError} from './errors.mjs';
import {normaliseEvent, digest} from './events.mjs';

export class EventBridge {
  constructor(config, {source, adapter, journal}) { Object.assign(this, {config, source, adapter, journal}); }

  mapping(assetId) { return this.config.mappings.find(row => row.assetId === assetId); }

  remember(state, eventId) {
    if (!state.recentEvents.includes(eventId)) state.recentEvents.push(eventId);
    state.recentEvents = state.recentEvents.slice(-1000);
  }

  async checkpoint(state, apply) { if (apply) await this.journal.write(state); }

  async complete(state, issue, remoteId, apply, result, resolved = issue.resolved) {
    state.entities[issue.key] = {remoteId, assetId: issue.assetId, observedOrder: issue.observedOrder,
      lastEvent: issue.eventId, resolved};
    delete state.pending[issue.key];
    this.remember(state, issue.eventId);
    await this.checkpoint(state, apply);
    result.delivered++;
  }

  async deliver(state, issue, {apply, recovering = false}, result) {
    const mapping = this.mapping(issue.assetId);
    insist(mapping, 'binding', 'Pending delivery has no configured website mapping.');
    const previous = state.entities[issue.key];
    const pending = state.pending[issue.key];
    let remoteId = previous?.remoteId || pending?.remoteId;
    let found;
    if (!remoteId) {
      found = await this.adapter.lookup(issue, mapping);
      remoteId = found?.id;
      if (recovering && pending?.phase === 'create' && !remoteId) {
        throw new BridgeError('uncertain-create', 'A previous create request has no confirmed external ID. No second ticket or alert was created. Use reconcile after checking the vendor console.');
      }
    }
    if (issue.resolved && !remoteId) { this.remember(state, issue.eventId); result.skipped++; await this.checkpoint(state, apply); return; }
    if (issue.resolved && !this.config.autoResolve) {
      state.entities[issue.key] = {...previous, remoteId, assetId: issue.assetId, resolved: previous?.resolved ?? found?.resolved ?? false,
        observedOrder: issue.observedOrder, lastEvent: issue.eventId, sourceResolved: true};
      delete state.pending[issue.key];
      this.remember(state, issue.eventId); result.resolutionsHeld++;
      await this.checkpoint(state, apply);
      return;
    }
    const phase = issue.resolved ? 'resolve' : remoteId ? 'update' : 'create';
    if (!apply) { result.preview.push({reference: issue.marker, assetId: issue.assetId, action: phase, severity: issue.severity}); return; }
    insist(Object.keys(state.entities).length < 20000 || previous, 'capacity', 'The bridge has reached its tracked issue capacity. Preserve the journal and contact support.');
    state.pending[issue.key] = {phase, issue, ...(remoteId ? {remoteId} : {})};
    await this.checkpoint(state, true);
    try {
      if (phase === 'create') remoteId = await this.adapter.create(issue, mapping);
      else if (phase === 'resolve') await this.adapter.resolve(issue, mapping, remoteId);
      else await this.adapter.update(issue, mapping, remoteId, previous || found || {});
    } catch (error) {
      if (error instanceof BridgeError && error.code === 'http' && !error.uncertain && error.status >= 400 && error.status < 500) {
        delete state.pending[issue.key];
        await this.checkpoint(state, true);
      }
      throw error;
    }
    await this.complete(state, issue, remoteId, true, result);
  }

  async run({apply = false, replay = false, maxPages = 5} = {}) {
    insist(!apply || this.config.provider !== 'connectwise', 'vendor-validation-required', 'ConnectWise delivery is disabled pending approved developer documentation and sandbox validation. Use preview or check.');
    insist(Number.isSafeInteger(maxPages) && maxPages >= 1 && maxPages <= 20, 'configuration', 'Use 1–20 event pages per run.');
    const me = await this.source.identity();
    const assets = new Map(me.assets.map(asset => [asset.id, asset]));
    for (const row of this.config.mappings) insist(assets.has(row.assetId), 'binding', 'A configured website is not in this connected-app credential. Reconnect after a website or customer changes.');
    const binding = digest(JSON.stringify(this.config.mappings.map(row => {
      const asset = assets.get(row.assetId); return [asset.id, asset.url, asset.clientId ?? null];
    }).sort((a,b) => a[0].localeCompare(b[0]))));
    const state = await this.journal.read();
    const result = {mode: apply ? 'apply' : 'preview', provider: this.config.provider,
      deliverySupported: this.config.provider !== 'connectwise', delivered: 0, skipped: 0, resolutionsHeld: 0, preview: []};
    if (state.installation !== null) {
      insist(state.installation === me.installation_id && state.fingerprint === this.config.fingerprint && state.binding === binding,
        'identity-change', 'Connection identity, destination or customer bindings changed. Preserve this journal and configure a separate state file after reviewing the new mappings.');
    } else {
      state.installation = me.installation_id; state.fingerprint = this.config.fingerprint; state.binding = binding;
    }
    if (apply) {
      await this.adapter.verify(this.config.mappings);
      for (const job of Object.values(state.pending)) {
        insist(assets.has(job.issue.assetId), 'binding', 'A pending delivery no longer has a selected website.');
        await this.deliver(state, job.issue, {apply: true, recovering: true}, result);
      }
    }
    if (state.cursor === null && apply && !replay) {
      state.cursor = (await this.source.events(0, true)).meta.next_cursor;
      await this.checkpoint(state, true);
      return {...result, initialised: true, cursor: state.cursor};
    }
    let cursor = state.cursor ?? 0;
    for (let page = 0; page < maxPages; page++) {
      const response = await this.source.events(cursor);
      for (const event of response.data) {
        if (state.recentEvents.includes(event.id)) { result.skipped++; continue; }
        if (!this.mapping(event.asset_id)) { result.skipped++; continue; }
        const issue = normaliseEvent(event, {installation: me.installation_id, assets, minimumSeverity: this.config.minimumSeverity});
        const previous = issue.key && state.entities[issue.key];
        if (issue.skip || issue.belowThreshold && !previous || previous && issue.observedOrder < previous.observedOrder) {
          this.remember(state, event.id); result.skipped++; continue;
        }
        const report = new URL('/', this.config.source.apiUrl);
        report.searchParams.set('asset', issue.assetId);
        if (issue.scanId) report.searchParams.set('scan', issue.scanId);
        report.hash = 'reports';
        issue.reportUrl = report.href;
        if (!apply) {
          if (!issue.resolved || previous && this.config.autoResolve) result.preview.push({reference: issue.marker, assetId: issue.assetId, action: issue.resolved ? 'resolve' : previous ? 'update' : 'create', severity: issue.severity});
          else result.skipped++;
        } else await this.deliver(state, issue, {apply}, result);
      }
      cursor = response.meta.next_cursor;
      state.cursor = cursor;
      await this.checkpoint(state, apply);
      if (!response.meta.has_more) break;
    }
    return {...result, cursor};
  }

  async reconcile(reference, remoteId) {
    const me = await this.source.identity();
    const state = await this.journal.read();
    insist(state.installation === me.installation_id && state.fingerprint === this.config.fingerprint, 'identity-change', 'Reconcile using the original connection and destination.');
    const jobs = Object.entries(state.pending).filter(([,job]) => job.issue.marker === reference);
    insist(jobs.length === 1, 'reconcile', 'Select one pending ScanTitan reference.');
    const [key, job] = jobs[0];
    insist(this.mapping(job.issue.assetId) && me.assets.some(asset => asset.id === job.issue.assetId), 'binding', 'The pending website is no longer selected.');
    const found = await this.adapter.lookup(job.issue, this.mapping(job.issue.assetId));
    insist(found && String(found.id) === String(remoteId), 'reconcile', 'The supplied vendor ID was not confirmed by its original customer and ScanTitan reference.');
    state.pending[key].remoteId = found.id;
    state.pending[key].phase = job.issue.resolved ? 'resolve' : 'update';
    await this.journal.write(state);
    return {reconciled: reference, nextAction: 'Run the bridge again to complete delivery.'};
  }
}
