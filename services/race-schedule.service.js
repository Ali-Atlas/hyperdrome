/**
 * Race schedule reads (SPEC.md 8): the next slot from the clock, a player's races in the committed
 * batch with their lock time, and the server-side replay that verifies a settled race from its
 * stored seed and snapshots.
 */
import { and, eq, inArray, or } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { getNear } from '@/lib/near';
import { replayRace } from './race-replay.js';
import { STRATEGY_WINDOW_MS, slotFor, slotStartMs } from './scheduler-deps.js';

const { adminConfig, batches, droneMods, drones, races, skins, mods, tracks, users } = schema;

/** @typedef {{ db?: any, near?: import('@/lib/near').NearAdapter }} Deps */

/**
 * Whether the scheduler commits new batches (`admin_config.racing_enabled`).
 * @param {Deps} [deps]
 * @returns {Promise<boolean>}
 */
export async function isRacingEnabled(deps = {}) {
  const db = deps.db ?? defaultDb;
  const [flag] = await db
    .select({ value: adminConfig.value })
    .from(adminConfig)
    .where(eq(adminConfig.key, 'racing_enabled'))
    .limit(1);
  return flag?.value === 'true';
}

/**
 * The next batch from the clock: the start of the next slot, and whether racing is paused.
 * @param {number} [now]
 * @param {Deps} [deps]
 * @returns {Promise<{ paused: boolean, slot: number, nextRaceAt: string }>}
 */
export async function getNextRace(now = Date.now(), deps = {}) {
  const slot = slotFor(now) + 1;
  return {
    paused: !(await isRacingEnabled(deps)),
    slot,
    nextRaceAt: new Date(slotStartMs(slot)).toISOString(),
  };
}

/**
 * The user's races in the committed batch (the strategy window and the lock), soonest first, and
 * the user's active drone count.
 * @param {string} userId
 * @param {Deps} [deps]
 * @returns {Promise<{ races: object[], activeDroneCount: number }>}
 */
export async function getUpcomingRacesForUser(userId, deps = {}) {
  const db = deps.db ?? defaultDb;
  /** @type {{ id: string, active: boolean }[]} */
  const owned = await db
    .select({ id: drones.id, active: drones.active })
    .from(drones)
    .where(eq(drones.userId, userId));
  const activeDroneCount = owned.filter((d) => d.active).length;
  if (owned.length === 0) return { races: [], activeDroneCount };
  const ids = owned.map((d) => d.id);
  /** @type {{ race: typeof races.$inferSelect, track: typeof tracks.$inferSelect, committedAt: Date | null, commitTx: string | null }[]} */
  const rows = await db
    .select({
      race: races,
      track: tracks,
      committedAt: batches.committedAt,
      commitTx: batches.commitTx,
    })
    .from(races)
    .innerJoin(batches, eq(races.batchSlot, batches.slot))
    .leftJoin(tracks, eq(races.trackId, tracks.id))
    .where(
      and(
        eq(batches.status, 'committed'),
        eq(races.status, 'pending'),
        or(inArray(races.drone1Id, ids), inArray(races.drone2Id, ids))
      )
    )
    .orderBy(races.batchSlot, races.raceIndex);
  if (rows.length === 0) return { races: [], activeDroneCount };
  const droneMap = await loadDronesWithJoins(db, [
    ...new Set(rows.flatMap(({ race }) => [race.drone1Id, race.drone2Id])),
  ]);
  const near = rows.some((r) => r.commitTx) ? (deps.near ?? getNear()) : null;
  const boundMods = await loadBoundMods(db, ids);
  const shaped = rows.map(({ race, track, committedAt, commitTx }) => ({
    ...shapePendingRace(
      race,
      track,
      droneMap[race.drone1Id],
      droneMap[race.drone2Id],
      userId,
      boundMods
    ),
    commitExplorerUrl: commitTx && near ? near.explorerTx(commitTx) : null,
    batchSlot: race.batchSlot,
    raceIndex: race.raceIndex,
    lockAt: committedAt ? new Date(committedAt.getTime() + STRATEGY_WINDOW_MS).toISOString() : null,
  }));
  return { races: shaped, activeDroneCount };
}

/**
 * Replay a settled race from its stored seed, snapshots, track and conditions (SPEC.md 5, 8):
 * 200 `{ match, raceId }`, 404 for an unknown race, 409 while it is not settled.
 * @param {string} raceId
 * @param {Deps} [deps]
 * @returns {Promise<{ status: number, body: { match: boolean, raceId: string } | { error: string } }>}
 */
export async function verifyRace(raceId, deps = {}) {
  const db = deps.db ?? defaultDb;
  const [row] = await db
    .select({ race: races, track: tracks })
    .from(races)
    .leftJoin(tracks, eq(races.trackId, tracks.id))
    .where(eq(races.id, raceId))
    .limit(1);
  if (!row) return { status: 404, body: { error: 'Race not found' } };
  const { race, track } = row;
  if (race.status !== 'completed' || !race.seed || !race.snapshotA || !race.snapshotB || !track) {
    return { status: 409, body: { error: 'Race not settled' } };
  }
  const result = replayRace({
    seed: race.seed,
    slot: Number(race.batchSlot),
    index: Number(race.raceIndex),
    snapshotA: race.snapshotA,
    snapshotB: race.snapshotB,
    track,
    weather: race.weather,
    timeOfDay: race.timeOfDay,
  });
  const winnerId = result.winner === 'a' ? race.drone1Id : race.drone2Id;
  const match =
    winnerId === race.winnerDroneId &&
    Math.round(Number(race.drone1Time) * 1000) === result.timeAms &&
    Math.round(Number(race.drone2Time) * 1000) === result.timeBms &&
    JSON.stringify(race.log) === JSON.stringify(result.log);
  return { status: 200, body: { match, raceId } };
}

/**
 * Shape one pending race for the upcoming views: both drones with stats and loadout, the track and
 * the conditions, and which side the viewer owns.
 * @param {typeof races.$inferSelect} race
 * @param {typeof tracks.$inferSelect | null} track
 * @param {any} drone1
 * @param {any} drone2
 * @param {string} viewerUserId
 * @param {Record<string, object[]>} boundMods the viewer's drones' bound mods, by drone id
 */
function shapePendingRace(race, track, drone1, drone2, viewerUserId, boundMods) {
  /** @param {any} d */
  const buildDrone = (d) =>
    d
      ? {
          id: d.id,
          name: d.name,
          level: d.level,
          elo: d.eloRating,
          ownerId: d.userId ?? null,
          ownerName: d.ownerName ?? null,
          tokenId: d.tokenId,
          stats: {
            speed: d.speed,
            turning: d.turning,
            acceleration: d.acceleration,
            durability: d.durability,
            nightVision: d.nightVision,
            batteryCapacity: d.batteryCapacity,
            rainHandling: d.rainHandling,
            windResistance: d.windResistance,
            consistency: d.consistency,
          },
          isBot: d.isBot,
          appliedSkin: d.appliedSkin
            ? {
                id: d.appliedSkin.id,
                name: d.appliedSkin.name,
                rarity: d.appliedSkin.rarity,
                imageUrl: d.appliedSkin.imageUrl,
              }
            : null,
          appliedMod: d.appliedMod
            ? {
                id: d.appliedMod.id,
                name: d.appliedMod.name,
                rarity: d.appliedMod.rarity,
                description: d.appliedMod.description,
                tokenId: d.appliedMod.tokenId,
                template: d.appliedMod.template,
              }
            : null,
          imageUrl: d.imageUrl,
          // Only the viewer's own drones carry their bound mods (the swap control).
          boundMods: d.userId === viewerUserId ? (boundMods[d.id] ?? []) : undefined,
        }
      : null;
  let userDroneId = null;
  if (drone1?.userId === viewerUserId) userDroneId = drone1.id;
  else if (drone2?.userId === viewerUserId) userDroneId = drone2.id;
  return {
    id: race.id,
    status: race.status,
    scheduledAt: race.scheduledAt,
    track: track
      ? {
          id: track.id,
          name: track.name,
          imageUrl: track.imageUrl,
          difficulty: track.difficulty,
          straights: track.straights,
          turns: track.turns,
          laps: track.laps,
          length: track.length,
        }
      : null,
    conditions: { weather: race.weather, timeOfDay: race.timeOfDay },
    drone1: buildDrone(drone1),
    drone2: buildDrone(drone2),
    userDroneId,
  };
}

/**
 * The mods bound to each of these drones, by drone id.
 * @param {any} db
 * @param {string[]} droneIds
 * @returns {Promise<Record<string, object[]>>}
 */
async function loadBoundMods(db, droneIds) {
  /** @type {{ droneId: string, id: string, tokenId: string | null, name: string, rarity: string, template: number | null }[]} */
  const rows = await db
    .select({
      droneId: droneMods.droneId,
      id: mods.id,
      tokenId: mods.tokenId,
      name: mods.name,
      rarity: mods.rarity,
      template: mods.template,
    })
    .from(droneMods)
    .innerJoin(mods, eq(droneMods.modId, mods.id))
    .where(inArray(droneMods.droneId, droneIds));
  /** @type {Record<string, object[]>} */
  const byDrone = {};
  for (const { droneId, ...mod } of rows) (byDrone[droneId] ??= []).push(mod);
  return byDrone;
}

/**
 * Drone rows with their applied skin and mod and the owner's username, by id.
 * @param {any} db
 * @param {string[]} droneIds
 * @returns {Promise<Record<string, any>>}
 */
async function loadDronesWithJoins(db, droneIds) {
  const rows = await db
    .select({ drone: drones, appliedSkin: skins, appliedMod: mods, ownerName: users.username })
    .from(drones)
    .leftJoin(skins, eq(drones.appliedSkinId, skins.id))
    .leftJoin(mods, eq(drones.appliedModId, mods.id))
    .leftJoin(users, eq(drones.userId, users.id))
    .where(inArray(drones.id, droneIds));
  return Object.fromEntries(
    rows.map((/** @type {any} */ { drone, appliedSkin, appliedMod, ownerName }) => [
      drone.id,
      { ...drone, appliedSkin, appliedMod, ownerName },
    ])
  );
}
