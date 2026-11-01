import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname, basename} from 'node:path';
import {Journal} from '../src/store.mjs';

test('journal is atomic, rejects concurrent workers and retains corrupt data for recovery', async () => {
  const parent=tmpdir();const folder=await mkdtemp(join(parent,'scantitan-msp-test-'));
  assert.equal(dirname(folder),parent);assert.ok(basename(folder).startsWith('scantitan-msp-test-'));
  const file=join(folder,'journal.json');const first=new Journal(file);const second=new Journal(file);
  try {
    await first.acquire();await assert.rejects(second.acquire(), e=>e.code==='locked');
    const state=await first.read();state.cursor=123;await first.write(state);assert.equal((await first.read()).cursor,123);
    assert.equal((await readFile(file,'utf8')).includes('client_secret'),false);
    await first.release();await second.acquire();assert.equal((await second.read()).cursor,123);
    await writeFile(file,'invalid-json');await assert.rejects(second.read(),/has not been reset/);
    assert.equal(await readFile(file,'utf8'),'invalid-json');
  } finally { await first.release();await second.release();await rm(folder,{recursive:true,force:true}); }
});
