/**
 * The settle phase of a scheduler tick (SPEC.md 4.4, 5, 6): for every committed batch of an
 * earlier slot, read `get_batch`, snapshot each drone's on-chain state, run the engine, send
 * `settle_batch` in chunks of 40 from the chain's `settled_count`, and apply the events to the
 * caches. A failed chain call leaves the batch committed for the next tick; the third failure
 * aborts it with `abort_batch` so its drones unlock.
 */
import { and, eq, lt } from 'drizzle-orm';
import { schema } from '@/lib/db';
import { ContractPanicError, RpcUnknownOutcomeError, TransactionFailedError } from '@/lib/near';
import { applyEvents } from './chain-cache.service.js';
import {
  SETTLE_CHUNK,
  chainResult,
  replayRace,
  snapshotOf,
  toBytes,
  toHex,
} from './race-replay.js';
import { CADENCE_S, resolveDeps } from './scheduler-deps.js';
import {
  finishBatch,
  finishSettledOnChain,
  markFailed,
  raceRows,
  writeResult,
} from './settle-store.js';

const { batches } = schema;

/** @typedef {import('./scheduler-deps.js').Deps} Deps */
/** @typedef {import('./scheduler-deps.js').FullDeps} FullDeps */
/** @typedef {typeof batches.$inferSelect} BatchRow */
/** @typedef {import('./race-replay.js').Snapshot} Snapshot */
/** @typedef {import('./race-replay.js').DroneView & { owner: string }} DroneView */
/** @typedef {import('./settle-store.js').RaceRow} RaceRow */
/** @typedef {{ seed_hash: number[], settled: boolean, settled_count: number, aborted: boolean }} ChainBatch */

/** Failed settle attempts after which the batch is aborted. */
export const MAX_SETTLE_ATTEMPTS = 3;
/** Views per call. */
const VIEW_CHUNK = 50;

/**
 * Settle every committed batch of a slot before `slot`, each on its own.
 * @param {number} slot the current slot
 * @param {Deps} [deps]
 * @returns {Promise<Record<string, string>>} outcome per batch slot
 */
export async function settleDueBatches(slot, deps = {}) {
  const full = resolveDeps(deps);
  /** @type {BatchRow[]} */
  const due = await full.db
    .select()
    .from(batches)
    .where(and(eq(batches.status, 'committed'), lt(batches.slot, slot)))
    .orderBy(batches.slot);
  /** @type {Record<string, string>} */
  const outcomes = {};
  for (const row of due) {
    try {
      outcomes[row.slot] = await settleBatch(row, full);
    } catch (err) {
      console.error({
        scope: 'scheduler',
        msg: 'settle failed',
        slot: row.slot,
        error: String(err),
      });
      outcomes[row.slot] = 'error';
    }
  }
  return outcomes;
}

/**
 * @param {BatchRow} row
 * @param {FullDeps} deps
 * @returns {Promise<string>} `settled`, `failed`, `pending` or `retry`
 */
async function settleBatch(row, deps) {
  const { db, near, secretKey } = deps;
  const chain = /** @type {ChainBatch | null} */ (await near.view('get_batch', { id: row.slot }));
  if (!chain) {
    const ageMs = Date.now() - (row.committedAt?.getTime() ?? 0);
    if (row.commitTx || ageMs >= CADENCE_S * 1000) {
      await markFailed(db, row.slot, 'batch is not on chain');
      return 'failed';
    }
    return 'pending';
  }
  if (chain.aborted) {
    await markFailed(db, row.slot, 'batch aborted on chain');
    return 'failed';
  }
  const seed = row.seed ?? toHex(near.openSecret(String(row.seedEnc), secretKey, String(row.slot)));
  const rows = await raceRows(db, row.slot);
  await finishSettledOnChain(rows, chain.settled_count, seed, deps);
  if (chain.settled) {
    await finishBatch(db, row, seed);
    return 'settled';
  }
  const remaining = rows.filter((r) => Number(r.race.raceIndex) >= chain.settled_count);
  const snapshots = await snapshotDrones(near, remaining);
  const results = remaining.map((r) => {
    const snapshotA = snapshots.get(r.tokenA);
    const snapshotB = snapshots.get(r.tokenB);
    if (!snapshotA || !snapshotB) throw new Error(`drone missing on chain in race ${r.race.id}`);
    const result = replayRace({
      seed,
      slot: row.slot,
      index: Number(r.race.raceIndex),
      snapshotA,
      snapshotB,
      track: r.track,
      weather: r.race.weather,
      timeOfDay: r.race.timeOfDay,
    });
    return { row: r, snapshotA, snapshotB, result };
  });
  for (const r of results) await writeResult(db, r);

  for (let from = chain.settled_count; from < rows.length; from += SETTLE_CHUNK) {
    const chunk = results.filter((r) => {
      const i = Number(r.row.race.raceIndex);
      return i >= from && i < from + SETTLE_CHUNK;
    });
    /** @type {import('@/lib/near').CallResult} */
    let res;
    try {
      res = await near.callAsSettlement('settle_batch', {
        batch_id: row.slot,
        seed: toBytes(seed),
        from,
        results: chunk.map((r) =>
          chainResult({
            a: r.row.tokenA,
            b: r.row.tokenB,
            result: r.result,
            snapshotA: r.snapshotA,
            snapshotB: r.snapshotB,
          })
        ),
      });
    } catch (err) {
      return settleFailed(row, err, deps);
    }
    const settleTxs = [.../** @type {string[]} */ (row.settleTxs ?? []), res.txHash];
    row.settleTxs = settleTxs;
    await db.update(batches).set({ settleTxs }).where(eq(batches.slot, row.slot));
    for (const r of chunk) await writeResult(db, r, { tx: res.txHash });
    try {
      await applyEvents(res.events, deps);
    } catch (err) {
      console.error({
        scope: 'scheduler',
        msg: 'cache update failed',
        slot: row.slot,
        error: String(err),
      });
    }
  }
  await finishBatch(db, row, seed);
  return 'settled';
}

/**
 * A refused or failed `settle_batch`: count the attempt and abort the batch on the third one.
 * `settled` (the chain is ahead of this tick) and an unknown outcome are not attempts; the next
 * tick re-reads `settled_count`.
 * @param {BatchRow} row
 * @param {unknown} err
 * @param {FullDeps} deps
 * @returns {Promise<string>}
 */
async function settleFailed(row, err, deps) {
  const { db, near } = deps;
  const panic = err instanceof ContractPanicError ? err.panic : null;
  if (panic === 'settled' || err instanceof RpcUnknownOutcomeError) {
    console.error({ scope: 'scheduler', msg: 'settle outcome unknown', slot: row.slot, panic });
    return 'retry';
  }
  if (!(err instanceof ContractPanicError) && !(err instanceof TransactionFailedError)) {
    throw err;
  }
  const attempts = row.attempts + 1;
  await db.update(batches).set({ attempts }).where(eq(batches.slot, row.slot));
  console.error({
    scope: 'scheduler',
    msg: 'settle_batch failed',
    slot: row.slot,
    panic,
    attempts,
  });
  if (attempts < MAX_SETTLE_ATTEMPTS) return 'retry';
  const res = await near.callAsSettlement('abort_batch', { batch_id: row.slot });
  await applyEvents(res.events, deps);
  await markFailed(db, row.slot, `aborted after ${attempts} failed settle attempts`);
  return 'failed';
}

/**
 * Snapshots of the drones in `rows` from their current on-chain state (SPEC.md 7): stats, equipped
 * mod and skin templates, level and elo.
 * @param {import('@/lib/near').NearAdapter} near
 * @param {RaceRow[]} rows
 * @returns {Promise<Map<string, Snapshot>>}
 */
async function snapshotDrones(near, rows) {
  const tokens = rows.flatMap((r) => [r.tokenA, r.tokenB]);
  /** @type {Map<string, DroneView>} */
  const views = new Map();
  for (let i = 0; i < tokens.length; i += VIEW_CHUNK) {
    const chunk = tokens.slice(i, i + VIEW_CHUNK);
    const out = /** @type {(DroneView | null)[]} */ (
      await near.view('get_drones', { tokens: chunk })
    );
    chunk.forEach((token, j) => {
      if (out[j]) views.set(token, /** @type {DroneView} */ (out[j]));
    });
  }
  const itemTokens = [...views.values()]
    .flatMap((v) => [v.hot.equipped_mod, v.hot.equipped_skin])
    .filter((t) => typeof t === 'string');
  /** @type {Map<string, number>} */
  const templates = new Map();
  for (let i = 0; i < itemTokens.length; i += VIEW_CHUNK) {
    const chunk = itemTokens.slice(i, i + VIEW_CHUNK);
    const out = /** @type {({ template: number } | null)[]} */ (
      await near.view('get_items', { tokens: chunk })
    );
    chunk.forEach((token, j) => templates.set(token, out[j]?.template ?? 0));
  }
  /** @param {string | null} token */
  const templateOf = (token) => (token ? (templates.get(token) ?? 0) : 0);
  return new Map([...views].map(([token, v]) => [token, snapshotOf(v, templateOf)]));
}
