#!/usr/bin/env node
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadConfig} from './config.mjs';
import {ScanTitanSource} from './source.mjs';
import {Journal} from './store.mjs';
import {EventBridge} from './bridge.mjs';
import {adapterFor} from './adapters/index.mjs';
import {BridgeError, insist} from './errors.mjs';

const help = `ScanTitan MSP bridge 0.1.0
Usage: scantitan-msp <preview|check|run|reconcile> --config bridge.json [options]

preview       Read ScanTitan events and show a delivery summary; no state or vendor writes.
check         Verify source identity, selected websites and vendor access; no vendor writes.
run --apply   Deliver new events and persist acknowledgements. First run starts with future events.
              --replay opts a NEW state file into existing event history.
reconcile     Confirm an uncertain create: --reference ST-... --remote-id ID --apply.

Options: --max-pages 1..20 (default 5). Run periodically with a scheduler; use one state file per connection.
Credentials are read from named environment variables, never command-line arguments.
Support: info@scantitan.com
`;

export function argumentsFor(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) return {command: 'help'};
  const command = argv.shift();
  insist(['preview','check','run','reconcile'].includes(command), 'arguments', 'Choose preview, check, run or reconcile.');
  const result = {command, apply: false, replay: false, maxPages: 5};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (name === '--apply') { result.apply = true; continue; }
    if (name === '--replay') { result.replay = true; continue; }
    insist(['--config','--reference','--remote-id','--max-pages'].includes(name) && typeof argv[i+1] === 'string' && !argv[i+1].startsWith('--'), 'arguments', 'Unknown or incomplete bridge option.');
    const value = argv[++i];
    if (name === '--config') result.file = resolve(value);
    else if (name === '--reference') result.reference = value;
    else if (name === '--remote-id') result.remoteId = value;
    else result.maxPages = Number(value);
  }
  insist(result.file, 'arguments', 'Select a private bridge configuration with --config.');
  insist(result.command === 'preview' || result.command === 'check' || result.apply, 'arguments', 'Vendor and journal changes require the explicit --apply flag.');
  insist(!result.apply || ['run','reconcile'].includes(command), 'arguments', 'preview and check do not accept --apply.');
  insist(!result.replay || command === 'run', 'arguments', '--replay applies only to a new run state.');
  insist(Number.isSafeInteger(result.maxPages) && result.maxPages >= 1 && result.maxPages <= 20, 'arguments', 'Use 1–20 event pages.');
  if (command === 'reconcile') insist(/^ST-[a-f0-9]{32}$/.test(result.reference || '') && /^[A-Za-z0-9-]{1,100}$/.test(result.remoteId || ''), 'arguments', 'Reconciliation requires a pending ST-reference and exact vendor ID.');
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  const options = argumentsFor([...argv]);
  if (options.command === 'help') { process.stdout.write(help); return; }
  const config = await loadConfig(options.file);
  const source = new ScanTitanSource(config);
  const journal = new Journal(config.stateFile);
  const adapter = options.command === 'preview' ? undefined : adapterFor(config);
  const bridge = new EventBridge(config, {source, adapter, journal});
  try {
    if (options.apply) await journal.acquire();
    let result;
    if (options.command === 'check') {
      const me = await source.identity();
      insist(config.mappings.every(row => me.assets.some(asset => asset.id === row.assetId)), 'binding', 'A configured website is not selected in this ScanTitan credential.');
      result = {source: 'passed', ...(await adapter.verify(config.mappings))};
    } else if (options.command === 'reconcile') result = await bridge.reconcile(options.reference, options.remoteId);
    else result = await bridge.run(options);
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally { await journal.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    const known = error instanceof BridgeError;
    process.stderr.write(JSON.stringify({error: known ? error.code : 'runtime', message: known ? error.message : 'Bridge operation failed. Check the local configuration and protected state; no credentials were logged.',
      ...(known && error.retryAfter ? {retryAfterSeconds: error.retryAfter} : {}),
      ...(known && error.uncertain ? {deliveryUnconfirmed: true} : {})}) + '\n');
    process.exitCode = known && error.status === 429 ? 75 : 1;
  });
}
