import {JsonHttp, environmentSecret} from './http.mjs';
import {insist} from './errors.mjs';

export class ScanTitanSource {
  constructor(config, {environment = process.env, transport = fetch} = {}) {
    const token = environmentSecret(config.source.tokenEnv, environment);
    insist(/^sti_[a-f0-9]{64}$/.test(token), 'credentials', 'Use a scoped ScanTitan connected-app credential.');
    this.provider = config.provider;
    this.http = new JsonHttp(config.source.apiUrl, {transport, headers: {Authorization: 'Bearer ' + token}});
  }

  async identity() {
    const me = (await this.http.request('/me'))?.data;
    insist(me && me.application === this.provider && Number.isSafeInteger(me.installation_id) && me.installation_id > 0,
      'identity', `Create a ${this.provider} connected-app credential for this bridge.`);
    insist(['Business', 'Consultant'].includes(me.plan?.id), 'plan', 'An active Business or Consultant plan is required.');
    insist(Array.isArray(me.scopes) && ['assets:read','events:read'].every(scope => me.scopes.includes(scope)), 'scope', 'The bridge needs assets:read and events:read.');
    insist(Array.isArray(me.assets), 'response', 'ScanTitan did not return selected websites.');
    for (const asset of me.assets) insist(asset && typeof asset.id === 'string' && typeof asset.name === 'string' && typeof asset.url === 'string', 'response', 'ScanTitan returned an invalid website binding.');
    return me;
  }

  async events(cursor, initial = false) {
    insist(initial || Number.isSafeInteger(cursor) && cursor >= 0, 'cursor', 'Invalid ScanTitan event cursor.');
    const response = await this.http.request(initial ? '/events?initial=1' : '/events?limit=100&after=' + cursor);
    insist(Array.isArray(response?.data) && Number.isSafeInteger(response.meta?.next_cursor) && typeof response.meta.has_more === 'boolean', 'cursor', 'ScanTitan returned an invalid event page.');
    insist(response.data.length <= 100 && response.meta.next_cursor >= (initial ? 0 : cursor)
      && !(response.meta.has_more && response.meta.next_cursor <= cursor), 'cursor', 'ScanTitan event pagination did not advance safely.');
    return response;
  }
}
