import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {HaloAdapter} from '../src/adapters/halopsa.mjs';
import {AcronisAdapter} from '../src/adapters/acronis.mjs';
import {configFor, env, issueFor} from './fixtures.mjs';

test('Halo create payload and recovery search use fields declared by the official OpenAPI contract', async () => {
  const contract=JSON.parse(await readFile(new URL('../contracts/halopsa.json',import.meta.url),'utf8'));
  const config=configFor();const adapter=new HaloAdapter(config,{environment:env});const payload=adapter.payload(issueFor(),config.mappings[0]);
  assert.equal(contract.create.body,'array');
  for(const [key,value] of Object.entries(payload)){
    const field=contract.create.fields[key];assert.ok(field,'Undocumented Halo field: '+key);
    assert.equal(typeof value,field.type==='integer'?'number':field.type);
    if(field.type==='integer')assert.ok(Number.isSafeInteger(value));
  }
  for(const key of ['search','client_id','site_id','open_only','pageinate','page_size','page_no','includecolumns'])assert.ok(contract.search_parameters.includes(key));
});

test('Acronis creation and exact dismissal conform to the public alert contract', async () => {
  const contract=JSON.parse(await readFile(new URL('../contracts/acronis.json',import.meta.url),'utf8'));
  const config=configFor('acronis');const adapter=new AcronisAdapter(config,{environment:env});const payload=adapter.payload(issueFor(),config.mappings[0]);
  for(const key of contract.create.required)assert.ok(Object.hasOwn(payload,key));
  assert.ok(contract.create.properties.severity.enum.includes(payload.severity));
  assert.match(payload.id,/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  for(const key of ['id','type'])assert.ok(contract.dismiss.parameters.includes(key));
});
