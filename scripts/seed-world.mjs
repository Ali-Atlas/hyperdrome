#!/usr/bin/env node
/**
 * Seed the world (SPEC.md 2.3, 13) on the chain and in the database of `.env.local`: the 16 tracks,
 * the `racing_enabled` switch, the 20 contract-owned bots and the catalog cache. Idempotent: every
 * step checks before it acts, so a second run changes nothing and a stopped run resumes.
 *
 *   npm run seed:world                  # racing_enabled is created false and otherwise left alone
 *   npm run seed:world -- --racing-on   # the same, and racing_enabled = true
 *
 * Bots are minted with the ops key (`NEAR_OPS_KEY`) to the game account (`NEAR_GAME_ID`). Keep
 * other users of the ops key off while it runs.
 */
import { RpcUnknownOutcomeError, getNear } from '../lib/near/index.js';
import { seedWorld } from '../services/world-seed.service.js';

/** @param {string} line */
const say = (line) => void process.stdout.write(`${line}\n`);

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--racing-on');
if (unknown.length > 0) {
  console.error(`unknown argument: ${unknown.join(', ')} (known: --racing-on)`);
  process.exit(1);
}

/**
 * The summary table: one line per step.
 * @param {import('../services/world-seed.service.js').StepReport[]} steps
 */
function table(steps) {
  const width = Math.max(...steps.map((s) => s.step.length), 'step'.length);
  /** @param {string | number} v */
  const num = (v) => String(v).padStart(7);
  say(`${'step'.padEnd(width)}  ${num('created')}  ${num('updated')}  ${num('skipped')}  note`);
  for (const s of steps) {
    say(
      `${s.step.padEnd(width)}  ${num(s.created)}  ${num(s.updated)}  ${num(s.skipped)}  ${s.note}`
    );
  }
}

try {
  const near = getNear();
  say(`World seed: contract ${near.gameId}, ops calls signed by ${near.ownerId}\n`);
  const { steps, txs } = await seedWorld({ racingOn: args.includes('--racing-on') }, { near });
  table(steps);
  if (txs.length > 0) {
    say(`\nTransactions (${txs.length}):`);
    for (const tx of txs) say(`  ${tx.label}  ${tx.url}`);
  }
  const changed = steps.reduce((n, s) => n + s.created + s.updated, 0);
  say(changed === 0 ? '\nNothing to do: every step skipped.' : `\nDone: ${changed} changes.`);
  process.exit(0);
} catch (err) {
  if (err instanceof RpcUnknownOutcomeError) {
    console.error(
      `\nA mint was sent and its outcome is unknown (${err.txHash}). Wait a minute, then run the seed again: it reads the chain first and mints only what is missing.`
    );
  } else {
    console.error('\nWorld seed failed.', err);
  }
  process.exit(1);
}
