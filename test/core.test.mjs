import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JsonHttp, ClientCredentials} from '../src/http.mjs';
import {validateConfig} from '../src/config.mjs';
import {normaliseEvent, observation, describe} from '../src/events.mjs';
import {ScanTitanSource} from '../src/source.mjs';
import {argumentsFor} from '../src/cli.mjs';
import {rawConfig, configFor, env, eventFor, issueFor, identities} from './fixtures.mjs';

test('rejects insecure origins, embedded credentials and accidental inline secrets', () => {
  for (const url of ['http://example.test','https://a:b@example.test','https://example.test?q=secret','https://example.test/#secret']) {
    assert.throws(()=>new JsonHttp(url));
  }
  for (const provider of ['acronis','halopsa','connectwise']) {
    assert.equal(configFor(provider).provider,provider);
    const raw=rawConfig(provider);raw.target.token='not-allowed';assert.throws(()=>validateConfig(raw),/Unknown vendor/);
  }
  const raw=rawConfig();raw.source.token='not-allowed';assert.throws(()=>validateConfig(raw),/outside the JSON/);
});

test('configuration requires exact customer mappings and safe resolution settings', () => {
  const raw=rawConfig();raw.mappings.push({...raw.mappings[0]});assert.throws(()=>validateConfig(raw),/unique/);
  const acronis=rawConfig('acronis');acronis.mappings[0].tenantId='00000000-0000-0000-0000-000000000000';assert.throws(()=>validateConfig(acronis),/customer tenant UUID/);
  const second=rawConfig();second.mappings[0].siteId=0;assert.throws(()=>validateConfig(second));
  const third=rawConfig();third.autoResolve=true;delete third.target.resolvedStatusId;assert.throws(()=>validateConfig(third),/resolvedStatusId/);
  const before=configFor();const fourth=rawConfig();fourth.target.priorityIds.high=8;
  assert.equal(validateConfig(fourth).fingerprint,before.fingerprint,'priority corrections preserve routing identity');
  fourth.mappings[0].clientId=99;assert.notEqual(validateConfig(fourth).fingerprint,before.fingerprint);
});

test('HTTP transport refuses redirects and redacts failed response bodies', async () => {
  let options;
  const http=new JsonHttp('https://vendor.example.test',{transport:async(url,opt)=>{options=opt;return new Response('secret-value',{status:500});}});
  await assert.rejects(http.request('/tickets',{method:'POST',body:{}}), e=>e.status===500&&e.uncertain&&!e.message.includes('secret-value'));
  assert.equal(options.redirect,'error');
  await assert.rejects(http.request('//unrelated.example.test'));
  const limited=new JsonHttp('https://vendor.example.test',{maxBytes:4,transport:async()=>new Response('123456')});
  await assert.rejects(limited.request('/tickets'),/oversized/);
});

test('rate limits expose a bounded delay and never echo the vendor response', async () => {
  const http=new JsonHttp('https://vendor.example.test',{transport:async()=>new Response('private',{status:429,headers:{'Retry-After':'999999'}})});
  await assert.rejects(http.request('/tickets'), e=>e.status===429&&e.retryAfter===3600&&!e.message.includes('private'));
});

test('OAuth client credentials are refreshed before expiry and not sent to API URLs', async () => {
  let now=0;const calls=[];
  const http=new JsonHttp('https://auth.example.test',{transport:async(url,options)=>{calls.push({url,options});return Response.json({access_token:'synthetic-token',expires_in:100,token_type:'Bearer'});}});
  const auth=new ClientCredentials(http,{path:'/token',clientId:'synthetic-id',clientSecret:'synthetic-secret',scope:'read:tickets',clock:()=>now});
  await auth.token();await auth.token();assert.equal(calls.length,1);
  now=80000;await auth.token();assert.equal(calls.length,2);
  assert.equal(calls[0].url,'https://auth.example.test/token');assert.match(calls[0].options.body,/grant_type=client_credentials/);
  assert.equal(calls[0].options.headers['Content-Type'],'application/x-www-form-urlencoded');
});

test('normalises UTC microsecond observations independently of the computer time zone', () => {
  assert.equal(observation('2026-11-01 12:00:00.123456').iso,'2026-11-01T12:00:00.123Z');
  assert.equal(observation('2026-11-01T14:00:00.123456+02:00').order,observation('2026-11-01 12:00:00.123456').order);
  assert.equal(observation('2026-11-01 12:00:00.123457').order-observation('2026-11-01 12:00:00.123456').order,1);
});

test('event conversion refuses cross-website payloads and removes query values and fragments', () => {
  const options={installation:44,assets:new Map(identities.map(a=>[a.id,a]))};
  assert.throws(()=>normaliseEvent(eventFor({}, {asset_id:'site-b'}),options),/bindings/);
  assert.throws(()=>normaliseEvent(eventFor({asset_id:'unselected'}),options),/selected/);
  const issue=issueFor();assert.equal(issue.location,'https://sample.example.test/path');
  assert.doesNotMatch(describe(issue),/never-copy|private/);
  assert.match(describe(issue),/unknown/);
  assert.equal(normaliseEvent(eventFor({}, {demo:true}),options).skip,'sample-data');
  assert.throws(()=>normaliseEvent(eventFor({}, {demo:undefined}),options),/real assessment/);
});

test('legacy monitor events without stable condition identities are not delivered', () => {
  const event=eventFor({type:'monitor.alert.opened',data:{module:'availability',severity:'high',demo:false}});
  assert.equal(normaliseEvent(event,{installation:44,assets:new Map(identities.map(a=>[a.id,a]))}).skip,'monitor-event-without-stable-identity');
});

test('source identity rejects another application, an excluded plan or insufficient scopes', async () => {
  for(const me of [{application:'n8n',plan:{id:'Business'},scopes:['assets:read','events:read']},
    {application:'halopsa',plan:{id:'Professional'},scopes:['assets:read','events:read']},
    {application:'halopsa',plan:{id:'Business'},scopes:['assets:read']}]) {
    const source=new ScanTitanSource(configFor(),{environment:env,transport:async()=>Response.json({data:{installation_id:44,assets:identities,...me}})});
    await assert.rejects(source.identity());
  }
});

test('source rejects non-progressing pages instead of repeatedly replaying a feed', async () => {
  const source=new ScanTitanSource(configFor(),{environment:env,transport:async()=>Response.json({data:[],meta:{next_cursor:5,has_more:true}})});
  await assert.rejects(source.events(5),/advance safely/);
});

test('CLI requires an explicit apply flag and never accepts credentials as arguments', () => {
  assert.throws(()=>argumentsFor(['run','--config','x.json']),/--apply/);
  assert.throws(()=>argumentsFor(['preview','--config','x.json','--token','secret']),/Unknown/);
  assert.throws(()=>argumentsFor(['check','--config','x.json','--apply']),/do not accept/);
  assert.equal(argumentsFor(['preview','--config','x.json']).apply,false);
});
