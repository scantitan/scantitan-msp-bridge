import {BridgeError, insist} from './errors.mjs';

export function httpsBase(value, label = 'API URL') {
  let url;
  try { url = new URL(value); } catch { throw new BridgeError('configuration', `${label} must be an absolute HTTPS URL.`); }
  insist(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
    'configuration', `${label} must use HTTPS without credentials, query or fragment.`);
  insist(!/%(?:2f|5c|2e)/i.test(url.pathname) && !url.pathname.includes('//'), 'configuration', `${label} contains an unsupported path.`);
  return url.href.replace(/\/+$/, '');
}

export class JsonHttp {
  constructor(base, {headers = {}, transport = fetch, timeout = 30000, maxBytes = 2097152} = {}) {
    this.base = httpsBase(base);
    this.headers = headers;
    this.transport = transport;
    this.timeout = timeout;
    this.maxBytes = maxBytes;
  }

  async request(path, {method = 'GET', body, headers = {}, allow404 = false, form = false} = {}) {
    insist(typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !/[\r\n\\]/.test(path), 'configuration', 'Invalid API request path.');
    const target = new URL(this.base + path);
    insist(target.origin === new URL(this.base).origin, 'configuration', 'API requests cannot change origin.');
    let response;
    try {
      response = await this.transport(target.href, {
        method, redirect: 'error', signal: AbortSignal.timeout(this.timeout),
        headers: {Accept: 'application/json', ...this.headers, ...headers,
          ...(body === undefined ? {} : {'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json'})},
        ...(body === undefined ? {} : {body: form ? new URLSearchParams(body).toString() : JSON.stringify(body)}),
      });
    } catch {
      throw new BridgeError('transport', 'API request failed or timed out. No credentials or response content were logged.', {uncertain: method !== 'GET'});
    }
    if (response.status === 404 && allow404) { await response.body?.cancel?.(); return null; }
    if (!response.ok) {
      await response.body?.cancel?.();
      const seconds = Number(response.headers?.get('retry-after'));
      throw new BridgeError('http', `API request returned HTTP ${response.status}. Check credentials, permissions and vendor configuration.`, {
        status: response.status, uncertain: method !== 'GET' && (response.status >= 500 || response.status === 408),
        retryAfter: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : undefined,
      });
    }
    if (response.status === 204) return null;
    const declared = Number(response.headers?.get('content-length'));
    if (Number.isFinite(declared) && declared > this.maxBytes) {
      await response.body?.cancel?.();
      throw new BridgeError('response', 'API response exceeded the permitted size.', {uncertain: method !== 'GET'});
    }
    let text = '';
    let size = 0;
    try {
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > this.maxBytes) { await reader.cancel(); throw new Error('limit'); }
          chunks.push(Buffer.from(part.value));
        }
        text = Buffer.concat(chunks).toString('utf8');
      } else {
        text = await response.text();
        if (Buffer.byteLength(text) > this.maxBytes) throw new Error('limit');
      }
      return text ? JSON.parse(text) : null;
    } catch {
      throw new BridgeError('response', 'API returned an invalid or oversized JSON response.', {uncertain: method !== 'GET'});
    }
  }
}

export function environmentSecret(name, environment = process.env) {
  insist(typeof name === 'string' && /^[A-Z][A-Z0-9_]{2,100}$/.test(name), 'configuration', 'Credentials must reference named environment variables.');
  const value = environment[name];
  insist(typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\r\n]/.test(value), 'credentials', `Set the ${name} environment variable in the bridge's private runtime.`);
  return value;
}

export class ClientCredentials {
  constructor(http, {path, clientId, clientSecret, scope, basic = false, clock = Date.now}) {
    Object.assign(this, {http, path, clientId, clientSecret, scope, basic, clock});
  }

  async token() {
    if (this.accessToken && this.expires > this.clock() + 30000) return this.accessToken;
    const body = {grant_type: 'client_credentials', ...(this.scope ? {scope: this.scope} : {})};
    const headers = {};
    if (this.basic) headers.Authorization = 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    else Object.assign(body, {client_id: this.clientId, client_secret: this.clientSecret});
    const result = await this.http.request(this.path, {method: 'POST', body, headers, form: true});
    insist(typeof result?.access_token === 'string' && result.access_token.length > 0 && !/[\r\n]/.test(result.access_token), 'authentication', 'Vendor did not return a valid access token.');
    insist(!result.token_type || result.token_type.toLowerCase() === 'bearer', 'authentication', 'Vendor returned an unsupported token type.');
    const seconds = Number(result.expires_in);
    const expiresOn = Number(result.expires_on);
    this.expires = Number.isFinite(seconds) && seconds > 0 ? this.clock() + Math.min(seconds, 86400) * 1000
      : Number.isFinite(expiresOn) && expiresOn > this.clock() / 1000 ? expiresOn * 1000 : this.clock() + 60000;
    this.accessToken = result.access_token;
    return this.accessToken;
  }

  invalidate() { this.accessToken = undefined; this.expires = 0; }
}
