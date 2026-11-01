import {readFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {httpsBase} from './http.mjs';
import {insist} from './errors.mjs';
import {digest, severityLevels} from './events.mjs';

export const providers = ['acronis', 'halopsa', 'connectwise'];
export const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const positiveId = value => Number.isSafeInteger(value) && value > 0;
const envReference = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,100}$/.test(value);

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}

export function validateConfig(raw, file = resolve('bridge.json')) {
  insist(raw && typeof raw === 'object' && !Array.isArray(raw) && raw.version === 1, 'configuration', 'Use bridge configuration version 1.');
  const rootKeys = ['version','provider','source','target','mappings','stateFile','minimumSeverity','autoResolve'];
  insist(Object.keys(raw).every(key => rootKeys.includes(key)), 'configuration', 'Unknown bridge configuration key. Keep credentials in environment variables.');
  insist(providers.includes(raw.provider), 'configuration', 'Choose acronis, halopsa or connectwise.');
  insist(raw.source && envReference(raw.source.tokenEnv), 'configuration', 'Configure a ScanTitan tokenEnv environment-variable name.');
  insist(Object.keys(raw.source).every(key => ['apiUrl','tokenEnv'].includes(key)), 'configuration', 'Unknown ScanTitan configuration key. Store the credential outside the JSON file.');
  const source = {apiUrl: httpsBase(raw.source.apiUrl || 'https://portal.scantitan.com/api/v2/integrations/apps'), tokenEnv: raw.source.tokenEnv};
  insist(source.apiUrl.endsWith('/api/v2/integrations/apps'), 'configuration', 'Use the ScanTitan Connected Apps API URL.');
  insist(raw.target && typeof raw.target === 'object', 'configuration', 'Configure the vendor target.');
  const target = {...raw.target, apiUrl: httpsBase(raw.target.apiUrl, 'Vendor API URL')};
  const targetKeys = raw.provider === 'acronis' ? ['apiUrl','clientIdEnv','clientSecretEnv','applicationCodeEnv','alertType','category']
    : raw.provider === 'halopsa' ? ['apiUrl','authUrl','clientIdEnv','clientSecretEnv','scope','ticketTypeId','openStatusId','resolvedStatusId','priorityIds']
      : ['apiUrl','company','clientIdEnv','publicKeyEnv','privateKeyEnv','boardId','openStatusId','resolvedStatusId','priorityIds'];
  insist(Object.keys(target).every(key => targetKeys.includes(key)), 'configuration', 'Unknown vendor configuration key. Credentials must use environment-variable references.');
  const minimumSeverity = raw.minimumSeverity ?? 'medium';
  insist(Object.hasOwn(severityLevels, minimumSeverity), 'configuration', 'Choose a valid minimumSeverity.');
  insist(raw.autoResolve === undefined || typeof raw.autoResolve === 'boolean', 'configuration', 'autoResolve must be a boolean.');
  const autoResolve = raw.autoResolve ?? false;
  if (raw.provider === 'connectwise') {
    insist(typeof target.company === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(target.company), 'configuration', 'Configure the ConnectWise company code.');
    for (const key of ['clientIdEnv','publicKeyEnv','privateKeyEnv']) insist(envReference(target[key]), 'configuration', `Configure ${key} as an environment-variable name.`);
    insist(positiveId(target.boardId) && positiveId(target.openStatusId), 'configuration', 'Configure the ConnectWise board and open status IDs.');
    insist(target.apiUrl.endsWith('/v4_6_release/apis/3.0'), 'configuration', 'Use the ConnectWise PSA REST API base ending in /v4_6_release/apis/3.0.');
  } else {
    for (const key of ['clientIdEnv','clientSecretEnv']) insist(envReference(target[key]), 'configuration', `Configure ${key} as an environment-variable name.`);
    if (raw.provider === 'acronis') {
      insist(new URL(target.apiUrl).pathname === '/', 'configuration', 'Use the Acronis data-center origin without an API path.');
      insist(envReference(target.applicationCodeEnv), 'configuration', 'Configure the Acronis applicationCodeEnv received from Vendor Portal.');
      insist(typeof target.alertType === 'string' && /^cti\.[a-zA-Z0-9_.~-]{10,500}$/.test(target.alertType), 'configuration', 'Use the registered Acronis CyberApp alert type CTI.');
      insist(typeof target.category === 'string' && /^cti\.[a-zA-Z0-9_.~-]{10,500}$/.test(target.category), 'configuration', 'Use the registered Acronis CyberApp alert category CTI.');
    } else {
      target.authUrl = httpsBase(target.authUrl, 'Halo authentication URL');
      insist(target.apiUrl.endsWith('/api'), 'configuration', 'Use the Halo resource URL ending in /api.');
      insist(typeof target.scope === 'string' && /^[a-zA-Z0-9_: -]{1,500}$/.test(target.scope), 'configuration', 'Configure the OAuth scopes permitted by your Halo application.');
      insist(positiveId(target.ticketTypeId) && positiveId(target.openStatusId), 'configuration', 'Configure Halo ticket type and open status IDs.');
    }
  }
  if (raw.provider !== 'acronis') {
    insist(target.priorityIds && typeof target.priorityIds === 'object' && Object.keys(severityLevels).every(key => positiveId(target.priorityIds[key])), 'configuration', 'Map every severity to a vendor priority ID.');
    if (autoResolve) insist(positiveId(target.resolvedStatusId), 'configuration', 'Configure resolvedStatusId before enabling automatic resolution.');
  }
  insist(Array.isArray(raw.mappings) && raw.mappings.length > 0 && raw.mappings.length <= 200, 'configuration', 'Configure 1–200 explicit website mappings.');
  const seen = new Set();
  const mappings = raw.mappings.map(row => {
    insist(row && typeof row.assetId === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(row.assetId) && !seen.has(row.assetId), 'configuration', 'Each selected website needs one unique assetId mapping.');
    seen.add(row.assetId);
    const mappingKeys = raw.provider === 'acronis' ? ['assetId','tenantId'] : raw.provider === 'halopsa' ? ['assetId','clientId','siteId'] : ['assetId','companyId','siteId'];
    insist(Object.keys(row).every(key => mappingKeys.includes(key)), 'configuration', 'Unknown customer mapping key.');
    if (raw.provider === 'acronis') insist(typeof row.tenantId === 'string' && uuidPattern.test(row.tenantId) && row.tenantId !== '00000000-0000-0000-0000-000000000000', 'configuration', 'Map each website to an exact Acronis customer tenant UUID.');
    else if (raw.provider === 'halopsa') insist(positiveId(row.clientId) && positiveId(row.siteId), 'configuration', 'Map each website to an exact Halo clientId and siteId.');
    else insist(positiveId(row.companyId) && (row.siteId === undefined || positiveId(row.siteId)), 'configuration', 'Map each website to an exact ConnectWise companyId and optional siteId.');
    return {...row};
  });
  insist(typeof raw.stateFile === 'string' && raw.stateFile.length > 0 && raw.stateFile.length <= 1000, 'configuration', 'Configure a private stateFile for this connection.');
  const config = {version: 1, provider: raw.provider, source, target, minimumSeverity, autoResolve, mappings,
    stateFile: resolve(dirname(file), raw.stateFile)};
  const {priorityIds, openStatusId, resolvedStatusId, scope, ...destination} = target;
  config.fingerprint = digest(canonical({provider: config.provider, source, target: destination, mappings}));
  return config;
}

export async function loadConfig(file) {
  const text = await readFile(file, 'utf8');
  insist(Buffer.byteLength(text) <= 1048576, 'configuration', 'The bridge configuration is too large.');
  let raw;
  try { raw = JSON.parse(text); } catch { insist(false, 'configuration', 'The bridge configuration is not valid JSON.'); }
  return validateConfig(raw, resolve(file));
}
