import { and, desc, eq, or, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import {
  calculateTSB,
  calculateXPToNextLevel,
  analyzeDronePerformance,
} from '@/lib/game-engine/economy.js';
import { ApiError } from '@/lib/api/response.js';
import { RACE_LIST_COLUMNS } from '@/services/race.service.js';

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
    // Exclude `raceLog` from the bulk select - the drone detail page's
    // history table doesn't read it, and pulling 10 jsonb blobs per
    // drone-detail load is wasted bandwidth. RACE_LIST_COLUMNS is the
    // shared projection used by `getRaces` for the same reason.
    db
      .select({
        race: RACE_LIST_COLUMNS,
        track: tracks,
      })
      .from(races)
      .leftJoin(tracks, eq(races.trackId, tracks.id))
      // status='completed' guard so the drone-detail "Race History"
      // table never renders a PENDING row. Pending races have a null
      // winnerDroneId, which the row mapper interpreted as a LOSS;
      // clicking that row routed to /races/[id] which correctly
      // showed the strategy view (status='pending'), but to the user
      // it looked like a completed race jumping to the upcoming view.
      .where(
        and(
          eq(races.status, 'completed'),
          or(eq(races.drone1Id, droneId), eq(races.drone2Id, droneId))
        )
      )
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
      ? {
          id: row.owner.id,
          username: row.owner.username,
          nearAccountId: row.owner.nearAccountId,
        }
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
  const [drone] = await db.select().from(drones).where(eq(drones.id, droneId)).limit(1);

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
