/**
 * Cache writes for `batch_settled` (SPEC.md 4.7, 7): each drone's post-race level, xp, elo, record
 * and cleared lock, the owners' race counts and active slots (SPEC.md 2.2), and the race row's
 * rewards (Volts of the winner and the loser, each drone's rating change). Balances arrive
 * through the call's `ft_mint`, which `applyEvents` turns into a balance read.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@/lib/db';
import { activeSlotsFor, calculateTSB, calculateXPToNextLevel } from '@/lib/game-engine/economy.js';
import { rowFor } from './chain-cache-rows.js';

const { users, drones, races } = schema;

/** @typedef {import('./chain-cache-rows.js').Ctx} Ctx */

/**
 * @typedef {{ i: number, a: string, b: string, winner: string, va: string, vb: string, elo_a: number, elo_b: number, xp_a: number, xp_b: number, lvl_a: number, lvl_b: number }} SettledRace
 *   `va` and `vb` are U128 strings of whole Volts: the token has 0 decimals (`ft_metadata`).
 */

/**
 * The reward columns of a race row from its `batch_settled` entry and the stored snapshots
 * (SPEC.md 7). Drone 1 of the row is `a`, drone 2 is `b`. The Volts are what the contract minted
 * for that drone in this race (payout plus level-up Volts; 0 for a bot, which has no beneficiary).
 * @param {SettledRace} entry
 * @param {{ elo: number }} snapshotA
 * @param {{ elo: number }} snapshotB
 */
export function raceRewards(entry, snapshotA, snapshotB) {
  const aWon = entry.winner === entry.a;
  const va = Number(BigInt(entry.va));
  const vb = Number(BigInt(entry.vb));
  return {
    pointsAwarded: aWon ? va : vb,
    loserPointsAwarded: aWon ? vb : va,
    drone1EloChange: entry.elo_a - snapshotA.elo,
    drone2EloChange: entry.elo_b - snapshotB.elo,
  };
}

/**
 * Write a race row's rewards from its `batch_settled` entry. The row is found by batch slot and
 * race index; without a row or its snapshots nothing is written.
 * @param {any} db
 * @param {number} batchId
 * @param {SettledRace} entry
 * @param {{ onlyUnwritten?: boolean }} [options] `onlyUnwritten` leaves a row whose rewards are
 *   stored (`loser_points_awarded` is set) as it is
 * @returns {Promise<'written' | 'skipped' | 'missing'>}
 */
export async function writeRaceRewards(db, batchId, entry, { onlyUnwritten = false } = {}) {
  const [row] = await db
    .select({
      id: races.id,
      snapshotA: races.snapshotA,
      snapshotB: races.snapshotB,
      loserPointsAwarded: races.loserPointsAwarded,
    })
    .from(races)
    .where(and(eq(races.batchSlot, batchId), eq(races.raceIndex, entry.i)))
    .limit(1);
  if (!row?.snapshotA || !row.snapshotB) return 'missing';
  if (onlyUnwritten && row.loserPointsAwarded !== null) return 'skipped';
  const written = await db
    .update(races)
    .set(raceRewards(entry, row.snapshotA, row.snapshotB))
    .where(
      onlyUnwritten
        ? and(eq(races.id, row.id), isNull(races.loserPointsAwarded))
        : eq(races.id, row.id)
    )
    .returning({ id: races.id });
  return written.length > 0 ? 'written' : 'skipped';
}

/**
 * One race of a `batch_settled` event: the race row's rewards, both drones, then their owners.
 * @param {Ctx} ctx
 * @param {SettledRace} race
 * @param {number} batchId
 */
export async function raceSettled(ctx, race, batchId) {
  await writeRaceRewards(ctx.db, batchId, race);
  for (const side of /** @type {const} */ (['a', 'b'])) {
    const token = race[side];
    const row = await rowFor(ctx, token);
    if (!row || row.kind !== 'drone') continue;
    const won = race.winner === token;
    const level = race[`lvl_${side}`];
    await ctx.db
      .update(drones)
      .set({
        level,
        xp: race[`xp_${side}`],
        xpToNextLevel: calculateXPToNextLevel(level),
        totalStatBudget: calculateTSB(level),
        eloRating: race[`elo_${side}`],
        wins: sql`${drones.wins} + ${won ? 1 : 0}`,
        losses: sql`${drones.losses} + ${won ? 0 : 1}`,
        totalRaces: sql`${drones.totalRaces} + 1`,
        inBatch: null,
        chainSyncedAt: new Date(),
      })
      .where(eq(drones.id, row.id));
    if (!row.userId) continue;
    const [user] = await ctx.db
      .update(users)
      .set({
        totalRaces: sql`${users.totalRaces} + 1`,
        totalWins: sql`${users.totalWins} + ${won ? 1 : 0}`,
      })
      .where(eq(users.id, row.userId))
      .returning({ totalRaces: users.totalRaces });
    if (user) await maybeUnlockSlot(ctx, row.userId, user.totalRaces);
  }
}

/**
 * Raise the user's active slots to what their lifetime races unlock (SPEC.md 2.2); never lowers.
 * @param {Ctx} ctx
 * @param {string} userId
 * @param {number} totalRaces
 */
async function maybeUnlockSlot(ctx, userId, totalRaces) {
  const slots = activeSlotsFor(totalRaces);
  await ctx.db
    .update(users)
    .set({ activeDroneSlots: sql`GREATEST(${users.activeDroneSlots}, ${slots})` })
    .where(eq(users.id, userId));
}
