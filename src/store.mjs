import {open, readFile, mkdir, rename, unlink, lstat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {BridgeError, insist} from './errors.mjs';

export class Journal {
  constructor(path) { this.path = path; this.lockPath = path + '.lock'; this.nonce = randomUUID(); }

  async acquire() {
    await mkdir(dirname(this.path), {recursive: true, mode: 0o700});
    try {
      this.handle = await open(this.lockPath, 'wx', 0o600);
      await this.handle.writeFile(JSON.stringify({pid: process.pid, startedAt: new Date().toISOString(), nonce: this.nonce}));
      await this.handle.sync();
    } catch (error) {
      if (error.code === 'EEXIST') throw new BridgeError('locked', 'Another worker owns this state file. After an unclean shutdown, verify that the recorded process stopped before removing its .lock file.');
      throw new BridgeError('storage', 'Cannot acquire the private bridge state lock.');
    }
    return this;
  }

  async read() {
    try {
      const stat = await lstat(this.path);
      insist(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 33554432, 'storage', 'The bridge state is not a supported private journal.');
      const state = JSON.parse(await readFile(this.path, 'utf8'));
      insist(state.version === 1 && state.entities && state.pending && Array.isArray(state.recentEvents), 'storage', 'Unsupported bridge state. Preserve it and restore a verified backup.');
      return state;
    } catch (error) {
      if (error.code === 'ENOENT') return {version: 1, cursor: null, installation: null, fingerprint: null, entities: {}, pending: {}, recentEvents: []};
      if (error instanceof BridgeError) throw error;
      throw new BridgeError('storage', 'Cannot read the bridge state. It has not been reset.');
    }
  }

  async write(state) {
    insist(this.handle, 'storage', 'Acquire the state lock before persisting a checkpoint.');
    const text = JSON.stringify(state);
    insist(Buffer.byteLength(text) <= 33554432, 'storage', 'State capacity reached. Preserve the state and contact support.');
    const temporary = this.path + '.' + this.nonce + '.tmp';
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, this.path);
  }

  async release() {
    if (!this.handle) return;
    await this.handle.close();
    this.handle = undefined;
    const lock = JSON.parse(await readFile(this.lockPath, 'utf8'));
    insist(lock.nonce === this.nonce, 'storage', 'The bridge lock owner changed.');
    await unlink(this.lockPath);
  }
}
