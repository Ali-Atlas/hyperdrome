/**
 * Backfill of the race rows' rewards (SPEC.md 7) for races settled before settlement wrote them:
 * every batch with settle transactions is read back from the chain (read-only), its
 * `batch_settled` events parsed, and each race row still on the column defaults written by batch
 * slot and race index with the settlement's own arithmetic (services/chain-cache-settle.js).
 * Run by `scripts/backfill-race-rewards.mjs`.
 */
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { ContractPanicError, TransactionFailedError, getNear } from '@/lib/near';
import { writeRaceRewards } from './chain-cache-settle.js';

const { batches, races } = schema;

/**
 * @typedef {object} BackfillCounts
 * @property {number} batches batches with settle transactions
 * @property {number} batchesRead batches with an unwritten race, read back from the chain
 * @property {number} transactions transactions read
 * @property {number} unknownTransactions transactions the RPC no longer knows
 * @property {number} failedTransactions transactions that failed on chain (nothing to read)
 * @property {number} written race rows written in this run
 * @property {number} alreadyWritten race rows of an event that were written before
 * @property {number} missing event entries without a race row or without its snapshots
 * @property {number} remaining completed batch races still on the defaults after the run
 */

/** Completed batch races whose rewards are not written. */
const unwritten = and(
  eq(races.status, 'completed'),
  isNotNull(races.batchSlot),
  isNull(races.loserPointsAwarded)
);

/**
 * Write the rewards of every race row that lacks them. Idempotent: a written row
 * (`loser_points_awarded` set) is never touched, and a batch without an unwritten race costs no
 * chain read.
 * @param {{ db?: any, near?: import('@/lib/near').NearAdapter, onBatch?: (line: string) => void }} [deps]
 * @returns {Promise<BackfillCounts>}
 */
export async function backfillRaceRewards(deps = {}) {
  const db = deps.db ?? defaultDb;
  const near = deps.near ?? getNear();
  /** @type {BackfillCounts} */
  const counts = {
    batches: 0,
    batchesRead: 0,
    transactions: 0,
    unknownTransactions: 0,
    failedTransactions: 0,
    written: 0,
    alreadyWritten: 0,
    missing: 0,
    remaining: 0,
  };
  /** @type {{ slot: number, settleTxs: unknown }[]} */
  const rows = await db
    .select({ slot: batches.slot, settleTxs: batches.settleTxs })
    .from(batches)
    .where(sql`coalesce(jsonb_array_length(${batches.settleTxs}), 0) > 0`)
    .orderBy(batches.slot);
  counts.batches = rows.length;
  for (const batch of rows) {
    const open = await db
      .select({ id: races.id })
      .from(races)
      .where(and(eq(races.batchSlot, batch.slot), unwritten));
    if (open.length === 0) continue;
    counts.batchesRead += 1;
    const before = counts.written;
    for (const txHash of /** @type {string[]} */ (batch.settleTxs)) {
      for (const entry of await settledRaces(near, txHash, batch.slot, counts)) {
        const outcome = await writeRaceRewards(db, batch.slot, entry, { onlyUnwritten: true });
        if (outcome === 'written') counts.written += 1;
        else if (outcome === 'skipped') counts.alreadyWritten += 1;
        else counts.missing += 1;
      }
    }
    deps.onBatch?.(`slot ${batch.slot}: ${counts.written - before} of ${open.length} written`);
  }
  const [left] = await db
    .select({ n: sql`count(*)::int` })
    .from(races)
    .where(unwritten);
  counts.remaining = Number(left?.n ?? 0);
  return counts;
}

/**
 * The `batch_settled` entries of one settle transaction for `slot`; none for an abort, a failed
 * transaction or a hash the RPC no longer knows.
 * @param {import('@/lib/near').NearAdapter} near
 * @param {string} txHash
 * @param {number} slot
 * @param {BackfillCounts} counts
 * @returns {Promise<import('./chain-cache-settle.js').SettledRace[]>}
 */
async function settledRaces(near, txHash, slot, counts) {
  counts.transactions += 1;
  let events;
  try {
    events = await near.transactionEvents(txHash);
  } catch (err) {
    if (!(err instanceof ContractPanicError) && !(err instanceof TransactionFailedError)) throw err;
    counts.failedTransactions += 1;
    return [];
  }
  if (!events) {
    counts.unknownTransactions += 1;
    return [];
  }
  return events
    .filter((e) => e.standard === 'hyperdrome' && e.event === 'batch_settled')
    .map((e) => /** @type {{ batch_id: number, races: any[] }} */ (e.data))
    .filter((d) => Number(d.batch_id) === slot)
    .flatMap((d) => d.races);
}
