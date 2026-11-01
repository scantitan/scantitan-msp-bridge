import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {execFile, execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, writeFile, rm, access, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {rawConfig, env, identities, eventFor} from './fixtures.mjs';

const execute = promisify(execFile);

test('real HTTPS worker retains customer mappings, private checkpoints and lost-acknowledgement recovery', {timeout:90000}, async () => {
  const parent=tmpdir();const folder=await mkdtemp(join(parent,'scantitan-msp-https-'));
  assert.equal(dirname(folder),parent);assert.ok(basename(folder).startsWith('scantitan-msp-https-'));
  const key=join(folder,'test.key');const certificate=join(folder,'test.crt');const opensslConfig=join(folder,'openssl.cnf');
  const cli=fileURLToPath(new URL('../src/cli.mjs',import.meta.url));
  let server;const results=[];
  try {
    await writeFile(opensslConfig,'[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n[dn]\nCN=localhost\n[extensions]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n');
    const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
    execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-keyout',key,'-out',certificate,'-config',opensslConfig],{windowsHide:true,stdio:'pipe'});
    const state={provider:'acronis',events:[eventFor()],alerts:new Map(),tickets:new Map(),created:0,failNextCreate:false,requests:0};
    const tenant='11111111-2222-4333-8444-555555555555';
    server=createServer({key:await readFile(key),cert:await readFile(certificate)},async(req,res)=>{
      const answer=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(data===undefined?'':JSON.stringify(data));};
      try {
        state.requests++;
        const url=new URL(req.url,'https://localhost');
        const source=url.pathname.startsWith('/api/v2/integrations/apps/');
        const token=url.pathname==='/api/2/idp/token'||url.pathname==='/auth/token';
        if(source) {
          assert.equal(req.headers.authorization,'Bearer '+env.SCANTITAN_TOKEN);
          if(url.pathname.endsWith('/me'))return answer({data:{installation_id:44,application:state.provider,plan:{id:'Business'},scopes:['assets:read','events:read'],assets:identities}});
          if(url.pathname.endsWith('/events')){
            const initial=url.searchParams.has('initial');const after=Number(url.searchParams.get('after')||0);
            return answer({data:initial?[]:state.events.slice(after),meta:{next_cursor:state.events.length,has_more:false}});
          }
          return answer({},404);
        }
        if(token) {
          const chunks=[];for await(const chunk of req)chunks.push(chunk);
          const values=new URLSearchParams(Buffer.concat(chunks).toString());
          assert.equal(values.get('grant_type'),'client_credentials');
          if(state.provider==='acronis')assert.equal(req.headers.authorization,'Basic '+Buffer.from('synthetic-client-id:synthetic-client-secret').toString('base64'));
          else assert.equal(values.get('client_secret'),'synthetic-client-secret');
          return answer({access_token:'synthetic-vendor-token',expires_in:3600});
        }
        assert.equal(req.headers.authorization,'Bearer synthetic-vendor-token');
        if(state.provider==='acronis')assert.equal(req.headers['x-application-secret'],'synthetic-app-code');
        if(url.pathname==='/api/2/tenants/'+tenant)return answer({id:tenant});
        if(url.pathname==='/api/Client/12')return answer({id:12});
        if(url.pathname==='/api/Site/31')return answer({id:31,client_id:12});
        if(url.pathname.startsWith('/api/alert_manager/v1/alerts/')&&req.method==='GET'){
          const record=state.alerts.get(url.pathname.split('/').at(-1));return record?answer(record):answer({},404);
        }
        if(url.pathname==='/api/alert_manager/v1/alerts'&&req.method==='DELETE'){
          assert.ok(url.searchParams.get('id'));assert.equal(state.alerts.get(url.searchParams.get('id'))?.tenant.id,tenant);
          const record=state.alerts.get(url.searchParams.get('id'));assert.ok(record);record.deletedAt='2026-11-01T12:05:00Z';return answer(undefined,204);
        }
        if(url.pathname==='/api/Tickets'&&req.method==='GET'){
          assert.equal(url.searchParams.get('client_id'),'12');assert.equal(url.searchParams.get('site_id'),'31');
          const tickets=[...state.tickets.values()].filter(t=>t.summary.includes(url.searchParams.get('search')));
          return answer({tickets,record_count:tickets.length});
        }
        if(url.pathname.startsWith('/api/Tickets/')&&req.method==='GET')return answer(state.tickets.get(Number(url.pathname.split('/').at(-1))));
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const body=JSON.parse(Buffer.concat(chunks).toString());
        assert.doesNotMatch(JSON.stringify(body),/never-copy/);
        if(url.pathname==='/api/alert_manager/v1/alerts'&&req.method==='POST'){
          assert.equal(body.tenantID,tenant);if(!state.alerts.has(body.id))state.created++;
          state.alerts.set(body.id,{...body,tenant:{id:body.tenantID}});
          if(state.failNextCreate){state.failNextCreate=false;req.socket.destroy();return;}
          return answer({id:body.id});
        }
        if(url.pathname==='/api/Tickets'&&req.method==='POST'){
          assert.equal(body.length,1);const value=body[0];const creating=!value.id;
          if(creating){assert.equal(value.client_id,12);assert.equal(value.site_id,31);value.id=77;state.created++;}
          const ticket={...state.tickets.get(value.id),...value};state.tickets.set(value.id,ticket);
          if(creating&&state.failNextCreate){state.failNextCreate=false;req.socket.destroy();return;}
          return answer([ticket],201);
        }
        answer({message:'Unrecognised synthetic fixture route'},404);
      } catch { answer({message:'Synthetic contract assertion failed'},500); }
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='https://127.0.0.1:'+server.address().port;
    for(const provider of ['acronis','halopsa']) {
      Object.assign(state,{provider,events:[eventFor()],alerts:new Map(),tickets:new Map(),created:0,failNextCreate:false});
      const config=rawConfig(provider);config.autoResolve=true;config.source.apiUrl=origin+'/api/v2/integrations/apps';
      config.target.apiUrl=provider==='acronis'?origin:origin+'/api';if(provider==='halopsa')config.target.authUrl=origin+'/auth';
      config.stateFile=join(folder,provider+'-state.json');const configPath=join(folder,provider+'-config.json');await writeFile(configPath,JSON.stringify(config));
      const childEnv={SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,...env};
      const run=async(args,trust=true)=>{
        const result=await execute(process.execPath,[cli,...args,'--config',configPath],{env:{...childEnv,...(trust?{NODE_EXTRA_CA_CERTS:certificate}:{})},windowsHide:true,maxBuffer:1048576,timeout:20000});
        assert.doesNotMatch(result.stdout,/synthetic-client-secret|sti_[a-f0-9]{64}|synthetic-vendor-token/);
        return JSON.parse(result.stdout);
      };
      await assert.rejects(run(['preview'],false),error=>error.code===1&&error.stderr.includes('transport'));
      const preview=await run(['preview']);assert.equal(preview.preview.length,1);
      await assert.rejects(access(config.stateFile));assert.equal(state.created,0);
      const initial=await run(['run','--apply']);assert.equal(initial.initialised,true);assert.equal(state.created,0);
      state.events.push(eventFor({id:'finding.updated:scan-b',type:'finding.updated',observed_at:'2026-11-01 12:01:00.000001'},{severity:'Critical'}));
      state.failNextCreate=true;
      await assert.rejects(run(['run','--apply']),error=>error.code===1&&error.stderr.includes('transport'));
      assert.equal(state.created,1);
      const recovery=await run(['run','--apply']);assert.equal(recovery.delivered,1);assert.equal(state.created,1);
      state.events.push(eventFor({id:'finding.resolved:scan-c',type:'finding.resolved',observed_at:'2026-11-01 12:05:00.000001'}));
      const resolved=await run(['run','--apply']);assert.equal(resolved.delivered,1);assert.equal(state.created,1);
      if(provider==='acronis')assert.ok([...state.alerts.values()][0].deletedAt);else assert.equal(state.tickets.get(77).status_id,9);
      const journal=JSON.parse(await readFile(config.stateFile,'utf8'));
      assert.equal(journal.cursor,3);assert.equal(Object.keys(journal.pending).length,0);
      assert.doesNotMatch(JSON.stringify(journal),/synthetic-client-secret|sti_[a-f0-9]{64}/);
      results.push({provider,real_cli:true,tls_validation:true,untrusted_certificate_rejected:true,future_events_default:true,lost_ack_recovered:true,created_records:state.created,resolution:true,real_vendor:false});
    }
    if(process.env.SCANTITAN_REHEARSAL_OUTPUT){
      const output=process.env.SCANTITAN_REHEARSAL_OUTPUT;
      await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({synthetic_fixture:true,production_customer_data:false,results},null,2));
    }
  } finally {
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await rm(folder,{recursive:true,force:true});
  }
});
