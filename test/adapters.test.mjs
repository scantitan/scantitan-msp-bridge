import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AcronisAdapter} from '../src/adapters/acronis.mjs';
import {HaloAdapter} from '../src/adapters/halopsa.mjs';
import {ConnectWiseAdapter} from '../src/adapters/connectwise.mjs';
import {configFor, env, issueFor} from './fixtures.mjs';

test('Acronis uses registered type, deterministic IDs, tenant scope and exact dismissal filters', async () => {
  const config=configFor('acronis');const issue=issueFor();const calls=[];let remote=null;
  const adapter=new AcronisAdapter(config,{environment:env,transport:async(url,options)=>{
    const path=new URL(url).pathname;calls.push({url,options});
    if(path.endsWith('/idp/token'))return Response.json({access_token:'synthetic-acronis-token',expires_in:3600});
    if(path.includes('/tenants/'))return Response.json({id:config.mappings[0].tenantId});
    if(options.method==='DELETE'){remote={...remote,deletedAt:'2026-11-01T13:00:00Z'};return new Response(null,{status:204});}
    if(options.method==='POST'){
      const body=JSON.parse(options.body);remote={...body,tenant:{id:body.tenantID}};return Response.json({id:body.id});
    }
    return remote?Response.json(remote):new Response(null,{status:404});
  }});
  await adapter.verify(config.mappings);assert.equal(await adapter.lookup(issue,config.mappings[0]),null);
  const id=await adapter.create(issue,config.mappings[0]);
  assert.match(id,/^[0-9a-f-]{36}$/);assert.equal(await adapter.update(issue,config.mappings[0],id),id);
  await adapter.resolve({...issue,resolved:true},config.mappings[0],id);
  const deletion=new URL(calls.find(c=>c.options.method==='DELETE').url);
  assert.equal(deletion.searchParams.get('id'),id);assert.equal(deletion.searchParams.get('type'),config.target.alertType);
  for(const call of calls)assert.equal(call.options.headers['X-Application-Secret'],'synthetic-app-code');
  const auth=calls.find(c=>c.url.endsWith('/idp/token'));assert.match(auth.options.headers.Authorization,/^Basic /);
  const post=calls.find(c=>c.url.endsWith('/alerts')&&c.options.method==='POST');
  assert.equal(JSON.parse(post.options.body).type,config.target.alertType);assert.doesNotMatch(post.options.body,/never-copy/);
});

test('Acronis rejects alerts belonging to another customer or another integration', async () => {
  const config=configFor('acronis');const adapter=new AcronisAdapter(config,{environment:env,transport:async()=>Response.json({})});const issue=issueFor();
  assert.throws(()=>adapter.assertOwned({id:adapter.id(issue,config.mappings[0]),tenant:{id:'wrong'},details:{fields:{'ScanTitan reference':issue.marker}}},issue,config.mappings[0]),/not owned/);
  await assert.rejects(adapter.resolve(issue,config.mappings[0],'unrelated-id'),/unrelated/);
});

test('Acronis validates the customer before sending an exact-ID dismissal', async () => {
  const config=configFor('acronis');const issue=issueFor();let deletes=0;let adapter;
  adapter=new AcronisAdapter(config,{environment:env,transport:async(url,options)=>{
    if(url.endsWith('/idp/token'))return Response.json({access_token:'synthetic-token',expires_in:3600});
    if(options.method==='DELETE')deletes++;
    return Response.json({id:adapter.id(issue,config.mappings[0]),tenant:{id:'99999999-2222-4333-8444-555555555555'},details:{fields:{'ScanTitan reference':issue.marker}}});
  }});
  await assert.rejects(adapter.resolve(issue,config.mappings[0],adapter.id(issue,config.mappings[0])),/not owned/);
  assert.equal(deletes,0);
});

test('Halo searches closed and open tickets, posts arrays, escapes HTML and preserves technician notes on updates', async () => {
  const config=configFor();const issue={...issueFor(),title:'Synthetic <script>alert(1)</script>'};const calls=[];let ticket;
  const adapter=new HaloAdapter(config,{environment:env,transport:async(url,options)=>{
    const parsed=new URL(url);calls.push({url,options});
    if(parsed.host==='halo-auth.example.test')return Response.json({access_token:'synthetic-halo-token',expires_in:3600});
    if(parsed.pathname==='/api/Client/12')return Response.json({id:12});
    if(parsed.pathname==='/api/Site/31')return Response.json({id:31,client_id:12});
    if(parsed.pathname==='/api/Tickets'&&options.method==='GET')return Response.json({tickets:ticket?[ticket]:[],record_count:ticket?1:0});
    if(parsed.pathname==='/api/Tickets'&&options.method==='POST'){
      const rows=JSON.parse(options.body);assert.equal(rows.length,1);ticket={...ticket,...rows[0],id:77};return Response.json([ticket]);
    }
    return Response.json(ticket);
  }});
  await adapter.verify(config.mappings);assert.equal(await adapter.lookup(issue,config.mappings[0]),null);
  const id=await adapter.create(issue,config.mappings[0]);assert.equal(id,77);
  assert.match(ticket.details,/&lt;script&gt;/);assert.doesNotMatch(ticket.details,/<script>/);
  ticket.details+=' Technician notes must remain.';
  await adapter.update({...issue,severity:'critical'},config.mappings[0],77);
  assert.match(ticket.details,/Technician notes must remain/);
  await adapter.resolve({...issue,resolved:true},config.mappings[0],77);assert.equal(ticket.status_id,9);
  const search=new URL(calls.find(c=>c.url.includes('search=')).url);assert.equal(search.searchParams.get('open_only'),'false');
  const changes=calls.filter(c=>c.options.method==='POST'&&c.url.includes('/Tickets')).map(c=>JSON.parse(c.options.body));
  assert.equal(changes[1][0].details,undefined);assert.equal(changes[1][0].priority_id,1);
});

test('Halo refuses wrong-customer and duplicate search matches before creating anything', async () => {
  const config=configFor();const issue=issueFor();let writes=0;
  const adapter=new HaloAdapter(config,{environment:env,transport:async(url,options)=>{
    if(options.method==='POST'&&url.endsWith('/token'))return Response.json({access_token:'synthetic-token',expires_in:3600});
    if(options.method!=='GET')writes++;
    return Response.json({tickets:[{id:1,summary:'['+issue.marker+']'},{id:2,summary:'['+issue.marker+']'}],record_count:2});
  }});
  await assert.rejects(adapter.lookup(issue,config.mappings[0]),/Multiple/);assert.equal(writes,0);
  assert.throws(()=>adapter.assertOwned({id:1,client_id:99,site_id:31,summary:'['+issue.marker+']'},issue,config.mappings[0]),/does not match/);
});

test('Halo refuses an incomplete recovery search instead of assuming no matching ticket', async () => {
  const adapter=new HaloAdapter(configFor(),{environment:env,transport:async url=>Response.json(url.endsWith('/token')
    ? {access_token:'synthetic-token',expires_in:3600} : {tickets:[],record_count:1})});
  await assert.rejects(adapter.lookup(issueFor(),configFor().mappings[0]),/complete, bounded/);
});

test('ConnectWise has read-only authentication checks and no enabled write path', async () => {
  const config=configFor('connectwise');const calls=[];
  const adapter=new ConnectWiseAdapter(config,{environment:env,transport:async(url,options)=>{calls.push({url,options});return Response.json([]);}});
  const result=await adapter.verify();assert.equal(result.liveWrites,false);
  await assert.rejects(adapter.create(issueFor(),config.mappings[0]), e=>e.code==='vendor-validation-required');
  assert.equal(calls.length,1);assert.equal(calls[0].options.method,'GET');
  assert.equal(calls[0].options.headers.clientId,'synthetic-client-id');
  assert.equal(Buffer.from(calls[0].options.headers.Authorization.slice(6),'base64').toString(),'synthetic-company+synthetic-public-key:synthetic-private-key');
});
