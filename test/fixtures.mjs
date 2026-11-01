import {validateConfig} from '../src/config.mjs';
import {normaliseEvent} from '../src/events.mjs';

export const sourceAsset = {id: 'site-a', name: 'Synthetic test website', url: 'https://sample.example.test', clientId: 'client-a', verified: true};
export const identities = [{...sourceAsset}, {...sourceAsset, id: 'site-b', name: 'Other selected website'}];
export const env = {SCANTITAN_TOKEN: 'sti_' + 'a'.repeat(64), VENDOR_CLIENT_ID: 'synthetic-client-id', VENDOR_CLIENT_SECRET: 'synthetic-client-secret',
  ACRONIS_APP_CODE: 'synthetic-app-code', CW_PUBLIC_KEY: 'synthetic-public-key', CW_PRIVATE_KEY: 'synthetic-private-key'};

export function rawConfig(provider = 'halopsa') {
  const target = provider === 'acronis'
    ? {apiUrl: 'https://acronis.example.test', clientIdEnv: 'VENDOR_CLIENT_ID', clientSecretEnv: 'VENDOR_CLIENT_SECRET', applicationCodeEnv: 'ACRONIS_APP_CODE',
      alertType: 'cti.a.p.am.alert.v1.0~test.scantitan.finding.v1.0', category: 'cti.a.p.am.category.v1.0~test.scantitan.security.v1.0'}
    : provider === 'halopsa'
      ? {apiUrl: 'https://halo.example.test/api', authUrl: 'https://halo-auth.example.test/auth', clientIdEnv: 'VENDOR_CLIENT_ID', clientSecretEnv: 'VENDOR_CLIENT_SECRET',
        scope: 'read:tickets edit:tickets read:customers', ticketTypeId: 4, openStatusId: 1, resolvedStatusId: 9, priorityIds: {info:5,low:4,medium:3,high:2,critical:1}}
      : {apiUrl: 'https://cw.example.test/v4_6_release/apis/3.0', company: 'synthetic-company', clientIdEnv: 'VENDOR_CLIENT_ID', publicKeyEnv: 'CW_PUBLIC_KEY', privateKeyEnv: 'CW_PRIVATE_KEY',
        boardId: 3, openStatusId: 1, resolvedStatusId: 7, priorityIds: {info:5,low:4,medium:3,high:2,critical:1}};
  return {version:1, provider, source:{apiUrl:'https://portal.example.test/api/v2/integrations/apps',tokenEnv:'SCANTITAN_TOKEN'},
    target, mappings:[provider === 'acronis' ? {assetId:'site-a',tenantId:'11111111-2222-4333-8444-555555555555'}
      : provider === 'halopsa' ? {assetId:'site-a',clientId:12,siteId:31} : {assetId:'site-a',companyId:12,siteId:31}],
    stateFile:'./state/test.json', minimumSeverity:'medium', autoResolve:false};
}

export const configFor = (provider = 'halopsa', extra = {}) => validateConfig({...rawConfig(provider), ...extra});

export function eventFor(extra = {}, data = {}) {
  return {schema_version:1,id:'finding.opened:scan-a:' + 'b'.repeat(64),type:'finding.opened',asset_id:'site-a',observed_at:'2026-11-01 12:00:00.123456',
    data:{id:'b'.repeat(64),asset_id:'site-a',scan_id:'scan-a',title:'Synthetic high finding',severity:'High',kind:'Vulnerabilities',demo:false,
      location:'https://sample.example.test/path?secret=never-copy#private',validation:'unknown',confidence:'unknown',...data},...extra};
}

export function issueFor(extra = {}, data = {}) {
  return normaliseEvent(eventFor(extra,data), {installation:44,assets:new Map(identities.map(a=>[a.id,a]))});
}

export class MemoryJournal {
  constructor(initial) { this.state = initial ?? {version:1,cursor:null,installation:null,fingerprint:null,entities:{},pending:{},recentEvents:[]}; this.writes = 0; }
  async read() { return structuredClone(this.state); }
  async write(state) { this.state = structuredClone(state); this.writes++; }
}

export function sourceFor(events = [eventFor()], provider = 'halopsa') {
  return {
    async identity() { return {installation_id:44,application:provider,assets:identities,plan:{id:'Business'},scopes:['assets:read','events:read']}; },
    async events(cursor, initial = false) {
      return {data:initial?[]:events.slice(cursor,cursor+100),meta:{next_cursor:initial?events.length:Math.min(cursor+100,events.length),has_more:!initial&&cursor+100<events.length}};
    },
  };
}

export class MemoryAdapter {
  constructor() { this.remote = new Map(); this.calls = []; this.created = 0; }
  async verify() { this.calls.push('verify'); return {verifiedMappings:1}; }
  async lookup(issue) { this.calls.push('lookup'); return this.remote.get(issue.key) || null; }
  async create(issue) { this.calls.push('create'); this.created++; this.remote.set(issue.key,{id:this.created,resolved:false}); return this.created; }
  async update(issue,mapping,id) { this.calls.push('update'); this.remote.set(issue.key,{id,resolved:false}); return id; }
  async resolve(issue,mapping,id) { this.calls.push('resolve'); this.remote.set(issue.key,{id,resolved:true}); return id; }
}
