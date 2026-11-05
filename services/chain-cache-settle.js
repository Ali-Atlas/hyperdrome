/**
 * Cache writes for `batch_settled` (SPEC.md 4.7, 7): each drone's post-race level, xp, elo, record
 * and cleared lock, and the owners' race counts and active slots (SPEC.md 2.2). Volts arrive
 * through the call's `ft_mint`, which `applyEvents` turns into a balance read.
 */
import { eq, sql } from 'drizzle-orm';
import { schema } from '@/lib/db';
import { activeSlotsFor, calculateTSB, calculateXPToNextLevel } from '@/lib/game-engine/economy.js';
import { rowFor } from './chain-cache-rows.js';

const { users, drones } = schema;

/** @typedef {import('./chain-cache-rows.js').Ctx} Ctx */

/**
 * @typedef {{ i: number, a: string, b: string, winner: string, elo_a: number, elo_b: number, xp_a: number, xp_b: number, lvl_a: number, lvl_b: number }} SettledRace
 */

/**
 * One race of a `batch_settled` event: both drones, then their owners.
 * @param {Ctx} ctx
 * @param {SettledRace} race
 */
export async function raceSettled(ctx, race) {
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
