/**
 * Verify a settled race from the command line, with no keys and no database (SPEC.md 11):
 * `npm run verify:race -- <race id> [--base <url>]`.
 *
 * It runs the same checks as the Verify button on the race page, with the same code
 * (`lib/client/race-verify.js`): the race's seed, snapshots and log come from the public race API
 * (`GET /api/races/<id>`), its `commit_batch` and `settle_batch` transactions from a public NEAR
 * testnet RPC, and the race is replayed here with the engine the server settles with.
 * Exit 0 when every check passes, 1 when one fails, 2 when the race cannot be checked.
 */
import { verifyRaceOnChain } from '@/lib/client/race-verify.js';
import { PUBLIC_EXPLORER_URL, explorerTxUrl } from '@/lib/near/explorer.js';

const DEFAULT_BASE = 'https://hyperdrome-near.vercel.app';

/** @param {string[]} argv */
function parseArgs(argv) {
  const args = { id: '', base: process.env.VERIFY_BASE_URL || DEFAULT_BASE };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base') args.base = argv[++i] ?? '';
    else if (!args.id) args.id = argv[i];
  }
  return args;
}

/** @param {string} message */
function stop(message) {
  console.error(message);
  process.exit(2);
}

const { id, base } = parseArgs(process.argv.slice(2));
if (!/^[0-9a-f-]{36}$/i.test(id)) {
  stop(
    'Usage: npm run verify:race -- <race id> [--base <url>]\n' +
      'The race id is the last part of a race page address, e.g. ' +
      `${DEFAULT_BASE}/races/<race id>. A settled race is listed at ${DEFAULT_BASE}/api/races.`
  );
}

const url = `${base.replace(/\/+$/, '')}/api/races/${encodeURIComponent(id)}`;
const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch((err) =>
  stop(`Could not read ${url}: ${err.message}`)
);
const body = await res.json().catch(() => stop(`${url} did not answer JSON (${res.status})`));
if (!res.ok) stop(`${url} answered ${res.status}: ${body.error ?? 'no race'}`);
const race = body.data;
if (race.status !== 'completed' || !race.commitTx || !race.settleTx) {
  stop(`Race ${id} is ${race.status}: only a settled race has its seed and transactions.`);
}

console.log(`Race ${id}, batch ${race.batchSlot}, race ${race.raceIndex}`);
console.log(`  ${race.drone1?.name ?? 'Drone 1'} against ${race.drone2?.name ?? 'Drone 2'}`);
console.log(`  race data  ${url}`);
console.log(`  commit     ${explorerTxUrl(PUBLIC_EXPLORER_URL, race.commitTx)}`);
console.log(`  settle     ${explorerTxUrl(PUBLIC_EXPLORER_URL, race.settleTx)}`);
console.log('');

const lines = await verifyRaceOnChain(race).catch((err) => stop(`Check stopped: ${err.message}`));
for (const line of lines) {
  console.log(`${line.pass ? 'PASS' : 'FAIL'}  ${line.label} (${line.detail})`);
}
const failed = lines.filter((line) => !line.pass).length;
console.log('');
console.log(
  failed === 0
    ? `All ${lines.length} checks passed.`
    : `${failed} of ${lines.length} checks failed.`
);
process.exit(failed === 0 ? 0 : 1);
