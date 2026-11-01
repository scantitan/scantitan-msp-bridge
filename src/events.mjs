import {createHash} from 'node:crypto';
import {insist} from './errors.mjs';

export const severityLevels = {info: 0, low: 1, medium: 2, high: 3, critical: 4};
export const digest = value => createHash('sha256').update(value).digest('hex');
export const clean = (value, maximum = 500) => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
export const htmlEscape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

export function stableUuid(key) {
  const namespace = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');
  const chars = createHash('sha1').update(namespace).update('scantitan:' + key).digest('hex').slice(0, 32).split('');
  chars[12] = '5';
  chars[16] = ['8','9','a','b'][parseInt(chars[16], 16) % 4];
  return [chars.slice(0,8), chars.slice(8,12), chars.slice(12,16), chars.slice(16,20), chars.slice(20)].map(p => p.join('')).join('-');
}

export function observation(value) {
  const match = typeof value === 'string' && /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)?$/.exec(value);
  insist(match, 'event', 'The event observation time is invalid.');
  const fraction = (match[3] || '').padEnd(6, '0');
  const milliseconds = Date.parse(match[1] + 'T' + match[2] + '.' + fraction.slice(0, 3) + (match[4] || 'Z'));
  const order = milliseconds * 1000 + Number(fraction.slice(3));
  insist(Number.isSafeInteger(order), 'event', 'The event observation time is outside the supported range.');
  return {iso: new Date(milliseconds).toISOString(), order};
}

function safeLocation(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    return clean(url.origin + url.pathname, 1000);
  } catch { return ''; }
}

export function normaliseEvent(event, {installation, assets, minimumSeverity = 'medium'}) {
  insist(event && event.schema_version === 1 && typeof event.id === 'string' && event.id.length <= 500 && !/[\r\n]/.test(event.id), 'event', 'Invalid ScanTitan event identity or schema.');
  insist(typeof event.asset_id === 'string' && assets.has(event.asset_id), 'binding', 'The event is not bound to a selected website.');
  const observed = observation(event.observed_at);
  if (!/^(finding\.(opened|updated|resolved)|monitor\.alert\.(opened|updated|resolved))$/.test(event.type)) return {skip: 'event-not-selected'};
  const data = event.data;
  insist(data && typeof data === 'object' && !Array.isArray(data), 'event', 'The event payload is invalid.');
  if (data.demo === true) return {skip: 'sample-data'};
  const finding = event.type.startsWith('finding.');
  insist(data.demo === false, 'event', 'Events must explicitly identify real assessment data.');
  if (!finding && typeof data.incident_id !== 'string') return {skip: 'monitor-event-without-stable-identity'};
  const identity = finding ? data.id : data.incident_id;
  insist(typeof identity === 'string' && /^[a-f0-9]{64}$/.test(identity), 'event', 'The event does not contain a stable finding or incident identity.');
  if (finding) insist(data.asset_id === event.asset_id, 'binding', 'Finding and event website bindings do not match.');
  const severity = String(data.severity).toLowerCase();
  insist(Object.hasOwn(severityLevels, severity) && Object.hasOwn(severityLevels, minimumSeverity), 'event', 'Unsupported finding severity.');
  const resolved = event.type.endsWith('.resolved');
  const key = digest(JSON.stringify([installation, event.asset_id, finding ? 'finding' : 'monitor', identity]));
  const issue = {
    key, marker: 'ST-' + key.slice(0, 32), eventId: event.id, assetId: event.asset_id,
    observedAt: observed.iso, observedOrder: observed.order, resolved, severity,
    belowThreshold: severityLevels[severity] < severityLevels[minimumSeverity],
    title: finding ? clean(data.title || 'Security finding', 300) : `Monitoring ${clean(data.module, 60)} alert`,
    website: clean(assets.get(event.asset_id).name, 180),
    location: finding ? safeLocation(data.location) : '',
    reportUrl: '', scanId: finding && typeof data.scan_id === 'string' ? clean(data.scan_id, 120) : '',
    kind: finding ? clean(data.kind, 60) : 'Monitoring',
    validation: finding ? clean(data.validation, 100) : 'monitor observation',
    confidence: finding ? clean(data.confidence, 100) : '',
  };
  return issue;
}

export function describe(issue) {
  return [
    'ScanTitan website security observation',
    `Reference: ${issue.marker}`, `Website: ${issue.website}`, `Title: ${issue.title}`,
    `Severity: ${issue.severity}`, `State: ${issue.resolved ? 'Resolved by a later covered assessment or monitoring observation' : 'Open'}`,
    `Observed: ${issue.observedAt}`, `Validation: ${issue.validation}`,
    ...(issue.confidence ? [`Confidence: ${issue.confidence}`] : []),
    ...(issue.location ? [`Location: ${issue.location}`] : []),
    ...(issue.reportUrl ? [`Review in ScanTitan: ${issue.reportUrl}`] : []),
    'Scanner observations require review. A finding is not a certification of compromise or complete assessment coverage.',
  ].join('\n');
}
