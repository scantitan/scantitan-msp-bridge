import {JsonHttp, environmentSecret} from '../http.mjs';
import {BridgeError, insist} from '../errors.mjs';
import {clean, describe} from '../events.mjs';
import {positiveId} from '../config.mjs';

/** Live ticket writes stay disabled until the approved vendor schema is validated. */
export class ConnectWiseAdapter {
  constructor(config, {environment = process.env, transport = fetch} = {}) {
    this.config = config;
    const publicKey = environmentSecret(config.target.publicKeyEnv, environment);
    const privateKey = environmentSecret(config.target.privateKeyEnv, environment);
    insist(!publicKey.includes(':') && !publicKey.includes('+'), 'credentials', 'The ConnectWise public key contains an invalid authentication separator.');
    this.http = new JsonHttp(config.target.apiUrl, {transport, headers: {
      Authorization: 'Basic ' + Buffer.from(`${config.target.company}+${publicKey}:${privateKey}`).toString('base64'),
      clientId: environmentSecret(config.target.clientIdEnv, environment),
    }});
  }

  payload(issue, mapping) {
    return {summary: '[' + issue.marker + '] ' + clean(issue.title, 60), initialDescription: describe(issue),
      company: {id: mapping.companyId}, board: {id: this.config.target.boardId},
      status: {id: this.config.target.openStatusId}, priority: {id: this.config.target.priorityIds[issue.severity]},
      ...(mapping.siteId ? {site: {id: mapping.siteId}} : {})};
  }

  async verify() {
    const result = await this.http.request('/service/tickets?pageSize=1&fields=id');
    insist(Array.isArray(result), 'destination', 'ConnectWise did not return the expected ticket list.');
    return {provider: 'connectwise', authentication: 'passed', liveWrites: false, verifiedMappings: 0,
      next: 'Approved ConnectWise Developer Network access and live sandbox contract validation are required.'};
  }

  async lookup() { throw new BridgeError('vendor-validation-required', 'ConnectWise ticket delivery is disabled pending approved developer documentation and sandbox validation.'); }
  async create() { return this.lookup(); }
  async update() { return this.lookup(); }
  async resolve() { return this.lookup(); }
}
