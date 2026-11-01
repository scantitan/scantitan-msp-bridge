import {JsonHttp, ClientCredentials, environmentSecret} from '../http.mjs';
import {insist} from '../errors.mjs';
import {describe, htmlEscape, clean} from '../events.mjs';
import {positiveId} from '../config.mjs';

export class HaloAdapter {
  constructor(config, {environment = process.env, transport = fetch} = {}) {
    this.config = config;
    this.http = new JsonHttp(config.target.apiUrl, {transport});
    this.auth = new ClientCredentials(new JsonHttp(config.target.authUrl, {transport}), {
      path: '/token', scope: config.target.scope,
      clientId: environmentSecret(config.target.clientIdEnv, environment),
      clientSecret: environmentSecret(config.target.clientSecretEnv, environment),
    });
  }

  async request(path, options = {}) {
    return this.http.request(path, {...options, headers: {...options.headers, Authorization: 'Bearer ' + await this.auth.token()}});
  }

  assertOwned(ticket, issue, mapping) {
    insist(ticket && positiveId(ticket.id) && ticket.client_id === mapping.clientId && ticket.site_id === mapping.siteId
      && typeof ticket.summary === 'string' && ticket.summary.includes('[' + issue.marker + ']'),
    'destination', 'The Halo ticket does not match this ScanTitan reference, customer and site.');
  }

  async readOwned(id, issue, mapping) {
    insist(positiveId(id), 'destination', 'Invalid Halo ticket ID.');
    const ticket = await this.request('/Tickets/' + id);
    this.assertOwned(ticket, issue, mapping);
    return ticket;
  }

  async lookup(issue, mapping) {
    const query = new URLSearchParams({search: issue.marker, client_id: String(mapping.clientId), site_id: String(mapping.siteId),
      open_only: 'false', pageinate: 'true', page_size: '100', page_no: '1', includecolumns: 'false'});
    const result = await this.request('/Tickets?' + query);
    insist(result && Array.isArray(result.tickets) && Number.isSafeInteger(result.record_count) && result.record_count === result.tickets.length
      && result.record_count <= 100, 'destination', 'Halo did not return a complete, bounded ticket search. No new ticket was created.');
    const matches = result.tickets.filter(row => row.summary?.includes('[' + issue.marker + ']'));
    insist(matches.length <= 1, 'duplicate', 'Multiple Halo tickets have this ScanTitan reference. Reconcile them before continuing.');
    if (!matches.length) return null;
    const ticket = await this.readOwned(matches[0].id, issue, mapping);
    return {id: ticket.id, resolved: ticket.status_id === this.config.target.resolvedStatusId};
  }

  payload(issue, mapping) {
    return {
      summary: '[' + issue.marker + '] ' + clean(issue.title, 200),
      details: htmlEscape(describe(issue)).replace(/\n/g, '<br>'),
      client_id: mapping.clientId, site_id: mapping.siteId,
      tickettype_id: this.config.target.ticketTypeId, status_id: this.config.target.openStatusId,
      priority_id: this.config.target.priorityIds[issue.severity],
    };
  }

  async create(issue, mapping) {
    const response = await this.request('/Tickets', {method: 'POST', body: [this.payload(issue, mapping)]});
    const ticket = Array.isArray(response) && response.length === 1 ? response[0] : response;
    this.assertOwned(ticket, issue, mapping);
    return ticket.id;
  }

  async update(issue, mapping, remoteId, previous = {}) {
    await this.readOwned(remoteId, issue, mapping);
    const body = {id: remoteId, priority_id: this.config.target.priorityIds[issue.severity],
      ...(previous.resolved ? {status_id: this.config.target.openStatusId} : {})};
    const response = await this.request('/Tickets', {method: 'POST', body: [body]});
    const ticket = Array.isArray(response) && response.length === 1 ? response[0] : response;
    this.assertOwned(ticket, issue, mapping);
    insist(ticket.id === remoteId, 'destination', 'Halo updated an unexpected ticket. Preserve the pending delivery.');
    return remoteId;
  }

  async resolve(issue, mapping, remoteId) {
    const ticket = await this.readOwned(remoteId, issue, mapping);
    if (ticket.status_id === this.config.target.resolvedStatusId) return remoteId;
    insist(positiveId(this.config.target.resolvedStatusId), 'configuration', 'A Halo resolution status must be explicitly configured.');
    const response = await this.request('/Tickets', {method: 'POST', body: [{id: remoteId, status_id: this.config.target.resolvedStatusId}]});
    const updated = Array.isArray(response) && response.length === 1 ? response[0] : response;
    this.assertOwned(updated, issue, mapping);
    insist(updated.id === remoteId && updated.status_id === this.config.target.resolvedStatusId, 'destination', 'Halo did not confirm the configured resolution status.');
    return remoteId;
  }

  async verify(mappings) {
    const checkedClients = new Set();
    const checkedSites = new Set();
    for (const mapping of mappings) {
      if (!checkedClients.has(mapping.clientId)) {
        const client = await this.request('/Client/' + mapping.clientId);
        insist(client?.id === mapping.clientId, 'destination', 'Halo did not confirm a configured customer.');
        checkedClients.add(mapping.clientId);
      }
      const siteKey = mapping.clientId + ':' + mapping.siteId;
      if (!checkedSites.has(siteKey)) {
        const site = await this.request('/Site/' + mapping.siteId);
        insist(site?.id === mapping.siteId && site.client_id === mapping.clientId, 'destination', 'The Halo site is not attached to the configured customer.');
        checkedSites.add(siteKey);
      }
    }
    return {provider: 'halopsa', verifiedMappings: mappings.length};
  }
}
