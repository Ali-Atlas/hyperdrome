import { and, desc, eq, or, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import {
  validateStatAllocation,
  calculateTSB,
  calculatePerStatCap,
  calculateXPToNextLevel,
  analyzeDronePerformance,
  STAT_KEYS,
} from '@/lib/game-engine/economy.js';
import { ApiError } from '@/lib/api/response.js';

/** Hard cap on drone level. Levels beyond this are not awarded; XP can
 *  accumulate but the drone stays at level 20 with no further TSB or
 *  player-wallet bonus payouts. */
const MAX_LEVEL = 20;

const { drones, users, skins, mods, droneMods, droneSkins, races, tracks } = schema;

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Return all drones owned by a user, with applied skin info joined in.
 * @param {string} userId
 */
export async function getAllDronesForUser(userId) {
  const rows = await db
    .select({
      drone: drones,
      skin: skins,
    })
    .from(drones)
    .leftJoin(skins, eq(drones.appliedSkinId, skins.id))
    .where(eq(drones.userId, userId))
    .orderBy(desc(drones.createdAt));

  return rows.map(({ drone, skin }) => ({ ...drone, appliedSkin: skin }));
}

/**
 * Return a single drone with its owner username, applied skin, applied mod,
 * the full bound-mod collection, and last 10 races.
 * @param {string} droneId
 */
export async function getDroneById(droneId) {
  const [row] = await db
    .select({
      drone: drones,
      owner: users,
      skin: skins,
    })
    .from(drones)
    .leftJoin(users, eq(drones.userId, users.id))
    .leftJoin(skins, eq(drones.appliedSkinId, skins.id))
    .where(eq(drones.id, droneId))
    .limit(1);

  if (!row) throw new ApiError('Drone not found', 404);

  const [recentRaces, modRows, skinRows] = await Promise.all([
    db
      .select({
        race: races,
        track: tracks,
      })
      .from(races)
      .leftJoin(tracks, eq(races.trackId, tracks.id))
      .where(or(eq(races.drone1Id, droneId), eq(races.drone2Id, droneId)))
      .orderBy(desc(races.createdAt))
      .limit(10),
    db
      .select({
        bindingId: droneMods.id,
        isEquipped: droneMods.isEquipped,
        mod: mods,
      })
      .from(droneMods)
      .innerJoin(mods, eq(droneMods.modId, mods.id))
      .where(eq(droneMods.droneId, droneId)),
    db
      .select({
        bindingId: droneSkins.id,
        isEquipped: droneSkins.isEquipped,
        skin: skins,
      })
      .from(droneSkins)
      .innerJoin(skins, eq(droneSkins.skinId, skins.id))
      .where(eq(droneSkins.droneId, droneId)),
  ]);

  const boundMods = modRows.map(({ bindingId, isEquipped, mod }) => ({
    ...mod,
    bindingId,
    isEquipped,
  }));
  const appliedMod = boundMods.find((m) => m.isEquipped) ?? null;

  const boundSkins = skinRows.map(({ bindingId, isEquipped, skin }) => ({
    ...skin,
    bindingId,
    isEquipped,
  }));

  return {
    ...row.drone,
    owner: row.owner
      ? { id: row.owner.id, username: row.owner.username }
      : null,
    appliedSkin: row.skin,
    appliedMod,
    boundMods,
    boundSkins,
    recentRaces: recentRaces.map(({ race, track }) => ({
      ...race,
      track,
    })),
  };
}

/**
 * How many drones the user currently has marked active.
 * @param {string} userId
 */
export async function getActiveDroneCount(userId) {
  const rows = await db
    .select({ id: drones.id })
    .from(drones)
    .where(and(eq(drones.userId, userId), eq(drones.active, true)));
  return rows.length;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

const STAT_SNAKE_TO_CAMEL = {
  speed: 'speed',
  turning: 'turning',
  acceleration: 'acceleration',
  durability: 'durability',
  night_vision: 'nightVision',
  battery_capacity: 'batteryCapacity',
  rain_handling: 'rainHandling',
  wind_resistance: 'windResistance',
  consistency: 'consistency',
};

/**
 * Apply a stat allocation.
 *
 * April 2026: cost is now paid from the owning player's `users.points`
 * wallet (not the per-drone `unspent_points` column, which is deprecated).
 * This function:
 *   1. verifies drone ownership,
 *   2. looks up the player's current balance,
 *   3. runs economy rules against that balance,
 *   4. deducts the cost from `users.points`,
 *   5. updates the drone's stats and bumps its `total_points_invested`
 *      running total (display/marketplace-value only, not spendable).
 *
 * The two writes are best-effort under the Neon HTTP driver (no txns).
 * If the second write fails the player will have been debited without
 * stats updating - rare given both statements target a single row each,
 * and logs surface via the caller's try/catch.
 *
 * @param {string} droneId
 * @param {string} userId
 * @param {Record<string, number>} statChanges - snake_case keys from API
 */
export async function allocateStats(droneId, userId, statChanges) {
  const [drone] = await db
    .select()
    .from(drones)
    .where(eq(drones.id, droneId))
    .limit(1);

  if (!drone) throw new ApiError('Drone not found', 404);
  if (drone.userId !== userId) {
    throw new ApiError('You do not own this drone', 403);
  }

  const [user] = await db
    .select({ id: users.id, points: users.points })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new ApiError('User not found', 404);

  const result = validateStatAllocation(drone, statChanges, {
    availablePoints: user.points,
  });
  if (!result.valid) {
    throw new ApiError('Invalid stat allocation', 400, result.errors);
  }

  // Debit the player's wallet first so a downstream drone-update failure
  // can't double-spend. Intentionally does not touch drones.unspent_points.
  if (result.totalCost > 0) {
    await db
      .update(users)
      .set({ points: sql`${users.points} - ${result.totalCost}` })
      .where(eq(users.id, userId));
  }

  // Build the drone SET payload: only stat columns that changed, plus the
  // running total_points_invested counter for display/marketplace value.
  const dronePayload = {
    totalPointsInvested:
      (drone.totalPointsInvested ?? 0) + result.totalCost,
  };
  for (const [snake, value] of Object.entries(statChanges ?? {})) {
    const camel = STAT_SNAKE_TO_CAMEL[snake] ?? snake;
    if (STAT_KEYS.includes(camel)) {
      dronePayload[camel] = value;
    }
  }

  const [updated] = await db
    .update(drones)
    .set(dronePayload)
    .where(eq(drones.id, droneId))
    .returning();

  return updated;
}

/**
 * Toggle a drone's active flag. When activating, enforces the user's
 * current `active_drone_slots` limit.
 * @param {string} droneId
 * @param {string} userId
 * @param {boolean} active
 */
export async function toggleActive(droneId, userId, active) {
  const [drone] = await db
    .select()
    .from(drones)
    .where(eq(drones.id, droneId))
    .limit(1);

  if (!drone) throw new ApiError('Drone not found', 404);
  if (drone.userId !== userId) {
    throw new ApiError('You do not own this drone', 403);
  }

  if (active && !drone.active) {
    const [userRow] = await db
      .select({ activeDroneSlots: users.activeDroneSlots })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const slots = userRow?.activeDroneSlots ?? 1;
    const currentActive = await getActiveDroneCount(userId);
    if (currentActive >= slots) {
      // Two distinct failure modes:
      //   - slots >= 3 (the hard ceiling enforced by maybeUnlockSlot in
      //     race.service.js): all slots already unlocked, the player just
      //     needs to free one up.
      //   - slots < 3: more slots are reachable by racing more.
      const message =
        slots >= 3
          ? `You already have ${slots} active drones. Deactivate one to activate this drone.`
          : `You already have ${slots} active drones. Run more races to unlock another slot.`;
      throw new ApiError(message, 400);
    }
  }

  const [updated] = await db
    .update(drones)
    .set({ active })
    .where(eq(drones.id, droneId))
    .returning();

  return updated;
}

/**
 * Derived performance summary for a drone, based purely on its current stats.
 * Does not hit the database.
 * @param {Record<string, number>} droneStats
 */
export function getDronePerformanceSummary(droneStats) {
  return analyzeDronePerformance(droneStats);
}

/**
 * Check and apply level-ups on a drone until XP is below the next threshold.
 *
 * Each level grants +20 TSB (bigger stat budget) and pays a +20-point
 * bonus into the *owning player's* wallet (non-bots only). The deprecated
 * drone.unspent_points column is left untouched.
 *
 * @param {string} droneId
 * @returns {Promise<{ leveledUp: boolean, newLevel: number, newTSB: number, bonusPointsAwarded: number }>}
 */
export async function checkAndLevelUp(droneId) {
  const [drone] = await db
    .select()
    .from(drones)
    .where(eq(drones.id, droneId))
    .limit(1);

  if (!drone) throw new ApiError('Drone not found', 404);

  let level = drone.level;
  let xp = drone.xp;
  let xpToNext = drone.xpToNextLevel;
  let tsb = drone.totalStatBudget;
  let bonusPoints = 0;
  let leveled = false;

  while (xp >= xpToNext && level < MAX_LEVEL) {
    xp -= xpToNext;
    level += 1;
    tsb = calculateTSB(level);
    bonusPoints += 20;
    xpToNext = calculateXPToNextLevel(level);
    leveled = true;
  }
  // Hit the cap with leftover XP - clamp the bar to "full" so the UI
  // doesn't show a misleading 90% etc. on a maxed drone.
  if (level >= MAX_LEVEL && xp > xpToNext) {
    xp = xpToNext;
  }

  if (!leveled) {
    return {
      leveledUp: false,
      newLevel: level,
      newTSB: tsb,
      bonusPointsAwarded: 0,
    };
  }

  await db
    .update(drones)
    .set({
      level,
      xp,
      xpToNextLevel: xpToNext,
      totalStatBudget: tsb,
    })
    .where(eq(drones.id, droneId));

  // Player gets the level-up bonus in their shared wallet (bots have no
  // owner, so their level-ups yield no payout - by design).
  if (drone.userId && !drone.isBot && bonusPoints > 0) {
    await db
      .update(users)
      .set({ points: sql`${users.points} + ${bonusPoints}` })
      .where(eq(users.id, drone.userId));
  }

  return {
    leveledUp: true,
    newLevel: level,
    newTSB: tsb,
    bonusPointsAwarded: bonusPoints,
  };
}
