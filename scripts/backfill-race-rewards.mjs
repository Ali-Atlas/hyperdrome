#!/usr/bin/env node
/**
 * Backfill the rewards on race rows settled before settlement wrote them (SPEC.md 7): the Volts of
 * the winner and the loser and each drone's rating change, read back from the `batch_settled`
 * events of every batch's settle transactions. Against the database and chain of `.env.local`.
 *
 *   npm run backfill:rewards
 *
 * Read-only on chain: it sends nothing and signs nothing. Idempotent: a row whose rewards are
 * written is skipped, so a second run writes 0. A transaction the RPC no longer keeps is counted
 * and its races stay on the column defaults.
 */
import { getNear } from '../lib/near/index.js';
import { backfillRaceRewards } from '../services/race-rewards-backfill.js';

/** @param {string} line */
const say = (line) => void process.stdout.write(`${line}\n`);

try {
  const near = getNear();
  say(`Race rewards backfill: contract ${near.gameId}\n`);
  const counts = await backfillRaceRewards({ near, onBatch: (line) => say(`  ${line}`) });
  say(`\nbatches with settle transactions  ${counts.batches}`);
  say(`batches read from the chain       ${counts.batchesRead}`);
  say(`transactions read                 ${counts.transactions}`);
  say(`  unknown to the RPC              ${counts.unknownTransactions}`);
  say(`  failed on chain                 ${counts.failedTransactions}`);
  say(`race rows written                 ${counts.written}`);
  say(`race rows already written         ${counts.alreadyWritten}`);
  say(`event entries without a race row  ${counts.missing}`);
  say(`completed races still on defaults ${counts.remaining}`);
  process.exit(0);
} catch (err) {
  console.error(
    `\nBackfill failed. ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
  );
  process.exit(1);
}
