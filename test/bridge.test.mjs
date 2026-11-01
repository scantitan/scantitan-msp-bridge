import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventBridge} from '../src/bridge.mjs';
import {BridgeError} from '../src/errors.mjs';
import {JsonHttp} from '../src/http.mjs';
import {configFor, MemoryAdapter, MemoryJournal, sourceFor, eventFor, issueFor, identities} from './fixtures.mjs';

function bridge(events, {adapter = new MemoryAdapter(), journal = new MemoryJournal(), config = configFor(), source = sourceFor(events)} = {}) {
  return {worker:new EventBridge(config,{source,adapter,journal}),adapter,journal,source};
}

test('first apply establishes a future-event cursor and does not import historic alerts', async () => {
  const {worker,adapter,journal}=bridge([eventFor()]);
  const result=await worker.run({apply:true});
  assert.equal(result.initialised,true);assert.equal(journal.state.cursor,1);assert.equal(adapter.created,0);
});

test('preview reads the feed without any vendor access or journal changes', async () => {
  const {worker,adapter,journal}=bridge([eventFor()]);
  const result=await worker.run();
  assert.equal(result.preview.length,1);assert.equal(result.preview[0].action,'create');
  assert.equal(journal.writes,0);assert.deepEqual(adapter.calls,[]);
});

test('replayed events and repeated runs create exactly one ticket', async () => {
  const events=[eventFor(),eventFor()];const {worker,adapter,journal}=bridge(events);
  await worker.run({apply:true,replay:true});await worker.run({apply:true,replay:true});
  assert.equal(adapter.created,1);assert.equal(journal.state.cursor,2);assert.equal(Object.keys(journal.state.entities).length,1);
});

test('lost create acknowledgement is reconciled before replay and never blindly recreated', async () => {
  const adapter=new MemoryAdapter();const create=adapter.create.bind(adapter);let fail=true;
  adapter.create=async(...args)=>{const id=await create(...args);if(fail){fail=false;throw new BridgeError('transport','Synthetic acknowledgement loss',{uncertain:true});}return id;};
  const {worker,journal}=bridge([eventFor()],{adapter});
  await assert.rejects(worker.run({apply:true,replay:true}),/acknowledgement loss/);
  assert.equal(journal.state.cursor,null);assert.equal(Object.keys(journal.state.pending).length,1);
  await worker.run({apply:true,replay:true});
  assert.equal(adapter.created,1);assert.equal(journal.state.cursor,1);assert.equal(Object.keys(journal.state.pending).length,0);
});

test('an unconfirmed create with no remote match stops instead of risking a duplicate', async () => {
  const adapter=new MemoryAdapter();let attempts=0;
  adapter.create=async()=>{attempts++;throw new BridgeError('transport','Synthetic timeout',{uncertain:true});};
  const {worker,journal}=bridge([eventFor()],{adapter});
  await assert.rejects(worker.run({apply:true,replay:true}),/timeout/);
  await assert.rejects(worker.run({apply:true,replay:true}), e=>e.code==='uncertain-create');
  assert.equal(attempts,1);assert.equal(Object.keys(journal.state.pending).length,1);
});

test('HTTP 408 after create preserves uncertainty and prevents a blind second request', async () => {
  const adapter=new MemoryAdapter();let attempts=0;
  const http=new JsonHttp('https://vendor.example.test',{transport:async()=>{attempts++;return new Response(null,{status:408});}});
  adapter.create=async()=>http.request('/Tickets',{method:'POST',body:[]});
  const {worker,journal}=bridge([eventFor()],{adapter});
  await assert.rejects(worker.run({apply:true,replay:true}),error=>error.status===408&&error.uncertain);
  assert.equal(Object.keys(journal.state.pending).length,1);
  await assert.rejects(worker.run({apply:true,replay:true}),error=>error.code==='uncertain-create');
  assert.equal(attempts,1);
});

test('operator reconciliation verifies the exact remote reference before resuming', async () => {
  const adapter=new MemoryAdapter();adapter.create=async()=>{throw new BridgeError('transport','Synthetic timeout',{uncertain:true});};
  const {worker,journal}=bridge([eventFor()],{adapter});
  await assert.rejects(worker.run({apply:true,replay:true}));
  const issue=issueFor();adapter.remote.set(issue.key,{id:77,resolved:false});
  await assert.rejects(worker.reconcile(issue.marker,'78'),/not confirmed/);
  await worker.reconcile(issue.marker,'77');await worker.run({apply:true,replay:true});
  assert.equal(journal.state.entities[issue.key].remoteId,77);assert.equal(Object.keys(journal.state.pending).length,0);
});

test('partial-page failure retains acknowledgements and resumes the remaining events', async () => {
  const events=[eventFor(),eventFor({id:'finding.opened:scan-b:'+'c'.repeat(64)},{id:'c'.repeat(64),title:'Second synthetic finding'}),
    eventFor({id:'finding.opened:scan-c:'+'d'.repeat(64)},{id:'d'.repeat(64),title:'Third synthetic finding'})];
  const adapter=new MemoryAdapter();const create=adapter.create.bind(adapter);let fail=true;
  adapter.create=async(issue,...rest)=>{if(issue.title.startsWith('Second')&&fail){fail=false;throw new BridgeError('http','Synthetic rejected request',{status:429,retryAfter:60});}return create(issue,...rest);};
  const {worker,journal}=bridge(events,{adapter});
  await assert.rejects(worker.run({apply:true,replay:true}));
  assert.equal(adapter.created,1);assert.equal(journal.state.cursor,null);
  await worker.run({apply:true,replay:true});
  assert.equal(adapter.created,3);assert.equal(journal.state.cursor,3);
});

test('old observations cannot reopen a newer resolved ticket', async () => {
  const opened=eventFor();const resolved=eventFor({id:'finding.resolved:new-scan',type:'finding.resolved',observed_at:'2026-11-01 12:01:00.000001'});
  const old=eventFor({id:'finding.opened:older-scan',observed_at:'2026-11-01 11:59:00.999999'});
  const {worker,adapter,journal}=bridge([opened,resolved,old],{config:configFor('halopsa',{autoResolve:true})});
  await worker.run({apply:true,replay:true});
  assert.equal(adapter.created,1);assert.equal(adapter.calls.filter(x=>x==='resolve').length,1);
  assert.equal(journal.state.entities[issueFor().key].resolved,true);
});

test('automatic resolution is opt-in and a later reopen retains the external ticket', async () => {
  const resolved=eventFor({id:'finding.resolved:scan-b',type:'finding.resolved',observed_at:'2026-11-01 12:01:00.000001'});
  const opened=eventFor({id:'finding.opened:scan-c',observed_at:'2026-11-01 12:02:00.000001'});
  const {worker,adapter,journal}=bridge([eventFor(),resolved,opened]);
  const result=await worker.run({apply:true,replay:true});
  assert.equal(result.resolutionsHeld,1);assert.equal(adapter.calls.includes('resolve'),false);assert.equal(adapter.created,1);
  assert.equal(journal.state.entities[issueFor().key].lastEvent,opened.id);
});

test('destination changes, credential replacement and changed customer bindings fail closed', async () => {
  const {worker,adapter,journal}=bridge([eventFor()]);await worker.run({apply:true,replay:true});
  const count=adapter.calls.length;
  const changed={...configFor(),fingerprint:'changed'};
  await assert.rejects(new EventBridge(changed,{source:sourceFor([]),adapter,journal}).run({apply:true}),/identity.*changed/);
  const source=sourceFor([]);source.identity=async()=>({installation_id:45,assets:identities});
  await assert.rejects(new EventBridge(configFor(),{source,adapter,journal}).run({apply:true}),/identity.*changed/);
  source.identity=async()=>({installation_id:44,assets:[{...identities[0],clientId:'different-client'},identities[1]]});
  await assert.rejects(new EventBridge(configFor(),{source,adapter,journal}).run({apply:true}),/identity.*changed/);
  assert.equal(adapter.calls.length,count);
});

test('sample findings, scan-completion messages and unmapped sites create no tickets', async () => {
  const events=[eventFor({}, {demo:true}),eventFor({type:'scan.completed',id:'scan.completed:scan-a',data:{coverage_complete:false,demo:false}}),
    eventFor({asset_id:'site-b',id:'finding.opened:other'},{asset_id:'site-b'})];
  const {worker,adapter}=bridge(events);const result=await worker.run({apply:true,replay:true});
  assert.equal(adapter.created,0);assert.equal(result.skipped,3);
});

test('new low findings are filtered but existing tickets still receive severity changes', async () => {
  const events=[eventFor(),eventFor({id:'finding.updated:scan-b',type:'finding.updated',observed_at:'2026-11-01 12:01:00.000001'},{severity:'Low'}),
    eventFor({id:'finding.opened:scan-c'},{id:'e'.repeat(64),severity:'Low'})];
  const {worker,adapter}=bridge(events);await worker.run({apply:true,replay:true});
  assert.equal(adapter.created,1);assert.equal(adapter.calls.filter(x=>x==='update').length,1);
});

test('ConnectWise cannot initialise an applied delivery journal while writes are disabled', async () => {
  const {worker,adapter,journal}=bridge([],{config:configFor('connectwise'),source:sourceFor([],'connectwise')});
  await assert.rejects(worker.run({apply:true}),e=>e.code==='vendor-validation-required');
  assert.equal(journal.writes,0);assert.deepEqual(adapter.calls,[]);
  const preview=await worker.run();assert.equal(preview.deliverySupported,false);
});
