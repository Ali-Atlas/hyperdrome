/**
 * Database writes of the settle phase (services/settle.service.js; SPEC.md 6, 7): the batch's race
 * rows, a race's snapshots and result, the finished or failed batch, and the catch-up for races
 * the chain settled before this database recorded them.
 */
import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { schema } from '@/lib/db';
import { activeSlotsFor, calculateTSB, calculateXPToNextLevel } from '@/lib/game-engine/economy.js';
import { replayRace, secondsString } from './race-replay.js';

const { drones, batches, races, tracks, users } = schema;

/** @typedef {typeof batches.$inferSelect} BatchRow */
/** @typedef {import('./race-replay.js').Snapshot} Snapshot */
/** @typedef {{ race: typeof races.$inferSelect, track: typeof tracks.$inferSelect, tokenA: string, tokenB: string, ownerA: string | null, ownerB: string | null }} RaceRow */
/** @typedef {{ hot: { level: number, xp: number, elo: number, wins: number, losses: number, in_batch: number | null } }} HotView */

/**
 * The batch's races in index order, with each drone's token and cached owner and the track row.
 * @param {any} db
 * @param {number} slot
 * @returns {Promise<RaceRow[]>}
 */
export async function raceRows(db, slot) {
  const d1 = alias(drones, 'd1');
  const d2 = alias(drones, 'd2');
  return db
    .select({
      race: races,
      track: tracks,
      tokenA: d1.tokenId,
      tokenB: d2.tokenId,
      ownerA: d1.userId,
      ownerB: d2.userId,
    })
    .from(races)
    .innerJoin(tracks, eq(races.trackId, tracks.id))
    .innerJoin(d1, eq(races.drone1Id, d1.id))
    .innerJoin(d2, eq(races.drone2Id, d2.id))
    .where(eq(races.batchSlot, slot))
    .orderBy(races.raceIndex);
}

/**
 * Store a race's snapshots and computed result. `settled` marks the race completed, with the
 * settle transaction's hash when this tick sent it (null when an earlier tick's send landed).
 * @param {any} db
 * @param {{ row: RaceRow, snapshotA: Snapshot, snapshotB: Snapshot, result: import('./race-replay.js').RaceResult }} r
 * @param {{ tx: string | null }} [settled]
 */
export async function writeResult(db, { row, snapshotA, snapshotB, result }, settled) {
  await db
    .update(races)
    .set({
      snapshotA,
      snapshotB,
      winnerDroneId: result.winner === 'a' ? row.race.drone1Id : row.race.drone2Id,
      drone1Time: secondsString(result.timeAms),
      drone2Time: secondsString(result.timeBms),
      log: result.log,
      ...(settled ? { settleTx: settled.tx, status: 'completed' } : {}),
    })
    .where(eq(races.id, row.race.id));
}

/**
 * Races the chain settled in an earlier tick that this database never finished (the send's outcome
 * was unknown, or the process died after it): their stored snapshots stand, the result is replayed,
 * and each drone's hot state, its owner's race counts and Volt balance are re-read or recounted.
 * @param {RaceRow[]} rows
 * @param {number} settledCount
 * @param {string} seed
 * @param {{ db: any, near: import('@/lib/near').NearAdapter }} deps
 */
export async function finishSettledOnChain(rows, settledCount, seed, { db, near }) {
  const stale = rows.filter(
    (r) => Number(r.race.raceIndex) < settledCount && r.race.status !== 'completed'
  );
  for (const r of stale) {
    const snapshotA = /** @type {Snapshot | null} */ (r.race.snapshotA);
    const snapshotB = /** @type {Snapshot | null} */ (r.race.snapshotB);
    if (!snapshotA || !snapshotB) {
      console.error({
        scope: 'scheduler',
        msg: 'settled race without snapshots',
        raceId: r.race.id,
      });
      continue;
    }
    const result = replayRace({
      seed,
      slot: Number(r.race.batchSlot),
      index: Number(r.race.raceIndex),
      snapshotA,
      snapshotB,
      track: r.track,
      weather: r.race.weather,
      timeOfDay: r.race.timeOfDay,
    });
    await writeResult(db, { row: r, snapshotA, snapshotB, result }, { tx: null });
    const views = /** @type {(HotView | null)[]} */ (
      await near.view('get_drones', { tokens: [r.tokenA, r.tokenB] })
    );
    const sides = /** @type {const} */ ([
      [r.race.drone1Id, r.ownerA, views[0], result.winner === 'a'],
      [r.race.drone2Id, r.ownerB, views[1], result.winner === 'b'],
    ]);
    for (const [droneId, userId, view, won] of sides) {
      if (view) await refreshDrone(db, droneId, view.hot);
      if (userId) await creditOwner(db, near, userId, won);
    }
  }
}

/**
 * @param {any} db
 * @param {string} droneId
 * @param {HotView['hot']} hot
 */
async function refreshDrone(db, droneId, hot) {
  await db
    .update(drones)
    .set({
      level: hot.level,
      xp: hot.xp,
      xpToNextLevel: calculateXPToNextLevel(hot.level),
      totalStatBudget: calculateTSB(hot.level),
      eloRating: hot.elo,
      wins: hot.wins,
      losses: hot.losses,
      totalRaces: hot.wins + hot.losses,
      inBatch: hot.in_batch,
      chainSyncedAt: new Date(),
    })
    .where(eq(drones.id, droneId));
}

/**
 * One more race for the owner: counts, active slots (SPEC.md 2.2) and the Volt balance.
 * @param {any} db
 * @param {import('@/lib/near').NearAdapter} near
 * @param {string} userId
 * @param {boolean} won
 */
async function creditOwner(db, near, userId, won) {
  const [user] = await db
    .update(users)
    .set({
      totalRaces: sql`${users.totalRaces} + 1`,
      totalWins: sql`${users.totalWins} + ${won ? 1 : 0}`,
    })
    .where(eq(users.id, userId))
    .returning({ totalRaces: users.totalRaces, account: users.nearAccountId });
  if (!user) return;
  /** @type {Record<string, unknown>} */
  const set = {
    activeDroneSlots: sql`GREATEST(${users.activeDroneSlots}, ${activeSlotsFor(user.totalRaces)})`,
  };
  if (user.account) {
    set.points = Number((await near.view('ft_balance_of', { account_id: user.account })) ?? 0);
  }
  await db.update(users).set(set).where(eq(users.id, userId));
}

/**
 * The batch is fully settled: the seed is stored plain on the batch and its races (SPEC.md 6).
 * @param {any} db
 * @param {BatchRow} row
 * @param {string} seed
 */
export async function finishBatch(db, row, seed) {
  await db
    .update(batches)
    .set({ status: 'settled', seed, seedEnc: null, settledAt: new Date() })
    .where(eq(batches.slot, row.slot));
  await db.update(races).set({ seed }).where(eq(races.batchSlot, row.slot));
}

/**
 * The batch cannot settle: it and its pending races are failed, and the cache lock cleared.
 * @param {any} db
 * @param {number} slot
 * @param {string} reason
 */
export async function markFailed(db, slot, reason) {
  console.error({ scope: 'scheduler', msg: 'batch failed', slot, reason });
  await db.update(batches).set({ status: 'failed' }).where(eq(batches.slot, slot));
  await db
    .update(races)
    .set({ status: 'failed' })
    .where(and(eq(races.batchSlot, slot), eq(races.status, 'pending')));
  await db.update(drones).set({ inBatch: null }).where(eq(drones.inBatch, slot));
}
