import {JsonHttp, ClientCredentials, environmentSecret} from '../http.mjs';
import {insist} from '../errors.mjs';
import {describe, stableUuid, clean} from '../events.mjs';

const severity = {info: 'information', low: 'information', medium: 'warning', high: 'error', critical: 'critical'};

export class AcronisAdapter {
  constructor(config, {environment = process.env, transport = fetch} = {}) {
    this.config = config;
    this.http = new JsonHttp(config.target.apiUrl, {transport, headers: {
      'X-Application-Secret': environmentSecret(config.target.applicationCodeEnv, environment),
    }});
    this.auth = new ClientCredentials(this.http, {
      path: '/api/2/idp/token', basic: true,
      clientId: environmentSecret(config.target.clientIdEnv, environment),
      clientSecret: environmentSecret(config.target.clientSecretEnv, environment),
    });
  }

  async request(path, options = {}) {
    return this.http.request(path, {...options, headers: {...options.headers, Authorization: 'Bearer ' + await this.auth.token()}});
  }

  id(issue, mapping) { return stableUuid('scantitan:acronis:' + mapping.tenantId.toLowerCase() + ':' + issue.key); }

  assertOwned(alert, issue, mapping) {
    insist(alert && String(alert.id).toLowerCase() === this.id(issue, mapping)
      && String(alert.tenant?.id).toLowerCase() === mapping.tenantId.toLowerCase()
      && alert.details?.fields?.['ScanTitan reference'] === issue.marker,
    'destination', 'The Acronis alert is not owned by this ScanTitan website and customer mapping.');
  }

  async lookup(issue, mapping) {
    const alert = await this.request('/api/alert_manager/v1/alerts/' + this.id(issue, mapping), {allow404: true});
    if (!alert) return null;
    this.assertOwned(alert, issue, mapping);
    return {id: alert.id, resolved: !!alert.deletedAt};
  }

  payload(issue, mapping) {
    return {
      id: this.id(issue, mapping), type: this.config.target.alertType,
      category: this.config.target.category, tenantID: mapping.tenantId,
      severity: severity[issue.severity],
      details: {
        title: clean('ScanTitan: ' + issue.title, 300), category: 'ScanTitan website security',
        description: describe(issue), fields: {
          'ScanTitan reference': issue.marker, 'Website': issue.website,
          'State': issue.resolved ? 'Resolved' : 'Open', 'Severity': issue.severity,
          'Last ScanTitan event': issue.eventId,
          ...(issue.reportUrl ? {url: issue.reportUrl} : {}),
        },
      },
    };
  }

  async create(issue, mapping) {
    const result = await this.request('/api/alert_manager/v1/alerts', {method: 'POST', body: this.payload(issue, mapping)});
    insist(typeof result?.id === 'string' && result.id.toLowerCase() === this.id(issue, mapping), 'destination', 'Acronis did not confirm the expected deterministic alert ID. Preserve the pending delivery for reconciliation.');
    return result.id;
  }

  async update(issue, mapping, remoteId) {
    insist(String(remoteId).toLowerCase() === this.id(issue, mapping), 'destination', 'Refusing to update an unrelated Acronis alert.');
    const existing = await this.lookup(issue, mapping);
    insist(existing, 'destination', 'The mapped Acronis alert was removed. Preserve the mapping and review it before creating another alert.');
    return this.create(issue, mapping);
  }

  async resolve(issue, mapping, remoteId) {
    insist(String(remoteId).toLowerCase() === this.id(issue, mapping), 'destination', 'Refusing to dismiss an unrelated Acronis alert.');
    const existing = await this.lookup(issue, mapping);
    if (!existing || existing.resolved) return remoteId;
    const query = new URLSearchParams({id: remoteId, type: this.config.target.alertType});
    await this.request('/api/alert_manager/v1/alerts?' + query, {method: 'DELETE'});
    return remoteId;
  }

  async verify(mappings) {
    for (const mapping of mappings) {
      const tenant = await this.request('/api/2/tenants/' + encodeURIComponent(mapping.tenantId));
      insist(typeof tenant?.id === 'string' && tenant.id.toLowerCase() === mapping.tenantId.toLowerCase(), 'destination', 'Acronis did not confirm a configured customer tenant.');
    }
    return {provider: 'acronis', verifiedMappings: mappings.length};
  }
}
