/**
 * Race reads (SPEC.md 8): the paginated list, one race with its drones, track and derived facts, and
 * the total count. Scheduling and settlement live in services/scheduler.service.js,
 * batch.service.js and settle.service.js; the next slot, upcoming races and verification in
 * services/race-schedule.service.js.
 */
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db as maybeDb, schema } from '@/lib/db';
import { ApiError } from '@/lib/api/response.js';
import { getNear } from '@/lib/near';

const { drones, users, races, tracks, skins, mods, batches } = schema;

/** @typedef {{ status?: string, trackId?: string, weather?: string, timeOfDay?: string, droneId?: string, userId?: string }} RaceFilters */

/** The database client; throws when DATABASE_URL is not set. */
function database() {
  if (!maybeDb) throw new Error('DATABASE_URL is not set');
  return maybeDb;
}

/**
 * Every column on the `races` table except the engine logs (`raceLog`, `log`) and the snapshots.
 * List-view consumers never read them; selecting them inflates every paginated read. The detail
 * query in `getRaceById` keeps the full row. Exported so the `recentRaces` subquery in
 * `drone.service.js` stays in sync.
 */
export const RACE_LIST_COLUMNS = {
  id: races.id,
  createdAt: races.createdAt,
  status: races.status,
  scheduledAt: races.scheduledAt,
  drone1Id: races.drone1Id,
  drone2Id: races.drone2Id,
  trackId: races.trackId,
  winnerDroneId: races.winnerDroneId,
  pointsAwarded: races.pointsAwarded,
  loserPointsAwarded: races.loserPointsAwarded,
  xpWinner: races.xpWinner,
  xpLoser: races.xpLoser,
  timeOfDay: races.timeOfDay,
  weather: races.weather,
  drone1Time: races.drone1Time,
  drone2Time: races.drone2Time,
  drone1EloBefore: races.drone1EloBefore,
  drone2EloBefore: races.drone2EloBefore,
  drone1EloChange: races.drone1EloChange,
  drone2EloChange: races.drone2EloChange,
  batchSlot: races.batchSlot,
  raceIndex: races.raceIndex,
  settleTx: races.settleTx,
};

/**
 * Paginated race list with optional filters.
 * @param {RaceFilters} [filters]
 * @param {{ page?: number, limit?: number }} [pagination]
 */
export async function getRaces(filters = {}, pagination = {}) {
  const db = database();
  const { page = 1, limit = 20 } = pagination;
  const offset = (page - 1) * limit;

  // Default status is 'completed' (the historical behavior - exclude
  // PENDING races since they have no winner/times/log and would render
  // as broken rows on most consumers). Callers can opt into other
  // statuses (e.g. 'pending' for the dashboard's Live Race Feed) by
  // passing `filters.status` explicitly.
  const requestedStatus = filters.status || 'completed';
  /** @type {import('drizzle-orm').SQL[]} */
  const conditions = [eq(races.status, requestedStatus)];
  if (filters.trackId) conditions.push(eq(races.trackId, filters.trackId));
  if (filters.weather) conditions.push(eq(races.weather, filters.weather));
  if (filters.timeOfDay) conditions.push(eq(races.timeOfDay, filters.timeOfDay));
  if (filters.droneId) {
    conditions.push(eitherSide(filters.droneId, filters.droneId));
  }
  if (filters.userId) {
    const userDrones = await db
      .select({ id: drones.id })
      .from(drones)
      .where(eq(drones.userId, filters.userId));
    if (userDrones.length === 0) return [];
    const userDroneIds = userDrones.map((d) => d.id);
    conditions.push(eitherSide(userDroneIds, userDroneIds));
  }

  const whereClause = and(...conditions);

  // Pending races sort by scheduledAt ASC (soonest first) so the live
  // feed reads as a queue counting down toward execution. Completed
  // races sort by createdAt DESC (newest first) so the most recent
  // results stay at the top.
  const orderClause = requestedStatus === 'pending' ? races.scheduledAt : desc(races.createdAt);

  // Explicit column list excludes `race_log` (jsonb) - none of the
  // list-view consumers (dashboard feed, recent results, races index,
  // drone history) read it, and including it inflates payload size on
  // every paginated read. The detail-page query in `getRaceById` keeps
  // raceLog because the Lead Tracker chart needs it.
  const rows = await db
    .select({ race: RACE_LIST_COLUMNS, track: tracks })
    .from(races)
    .leftJoin(tracks, eq(races.trackId, tracks.id))
    .where(whereClause)
    .orderBy(orderClause)
    .limit(limit)
    .offset(offset);

  const droneIds = new Set();
  rows.forEach(({ race }) => {
    droneIds.add(race.drone1Id);
    droneIds.add(race.drone2Id);
  });
  const droneList = droneIds.size
    ? await db
        .select({ drone: drones, appliedSkin: skins })
        .from(drones)
        .leftJoin(skins, eq(drones.appliedSkinId, skins.id))
        .where(inArray(drones.id, Array.from(droneIds)))
    : [];
  const droneMap = Object.fromEntries(
    droneList.map(({ drone, appliedSkin }) => [drone.id, { ...drone, appliedSkin }])
  );

  return rows.map(({ race, track }) => ({
    ...race,
    track,
    drone1: droneMap[race.drone1Id],
    drone2: droneMap[race.drone2Id],
  }));
}

/**
 * Fetch a single race with all drone + track details, plus a few
 * convenience fields derived from the races table so the detail page
 * can render without extra round trips:
 *   - `isUpset` - true when the winner's pre-race ELO was >= 50 lower
 *     than the loser's.
 *   - `isNewTrackRecord` - true when this race's winning time is the
 *     fastest recorded on the track at/before it ran.
 *   - `h2h` - { total, drone1Wins, drone2Wins } across all prior +
 *     current races between the same two drones in either slot.
 *
 * @param {string} raceId
 */
export async function getRaceById(raceId) {
  const db = database();
  const [row] = await db
    .select({ race: races, track: tracks })
    .from(races)
    .leftJoin(tracks, eq(races.trackId, tracks.id))
    .where(eq(races.id, raceId))
    .limit(1);
  if (!row) throw new ApiError('Race not found', 404);

  const race = row.race;

  // Owner username is needed by the race detail UI: the COMPLETED
  // DroneCard renders "YOU" for the viewer's own drone and the opponent's
  // username for the other slot. The PENDING MatchupDroneCard already
  // reads `drone.owner.username` - this join makes that path live too.
  const droneRows = await db
    .select({
      drone: drones,
      appliedSkin: skins,
      appliedMod: mods,
      ownerUsername: users.username,
    })
    .from(drones)
    .leftJoin(skins, eq(drones.appliedSkinId, skins.id))
    .leftJoin(mods, eq(drones.appliedModId, mods.id))
    .leftJoin(users, eq(drones.userId, users.id))
    .where(inArray(drones.id, [race.drone1Id, race.drone2Id]));
  const byId = Object.fromEntries(
    droneRows.map(({ drone, appliedSkin, appliedMod, ownerUsername }) => [
      drone.id,
      {
        ...drone,
        appliedSkin,
        appliedMod,
        owner: ownerUsername ? { username: ownerUsername } : null,
      },
    ])
  );

  // Upset: pre-race ELO gap of 50+ in the loser's favour. Only meaningful
  // for completed races - PENDING rows have no winner yet so isUpset is
  // forced false (the ternary below would otherwise pick drone2EloBefore
  // when winnerDroneId is null, producing nonsense).
  const winnerEloBefore =
    race.winnerDroneId === race.drone1Id ? race.drone1EloBefore : race.drone2EloBefore;
  const loserEloBefore =
    race.winnerDroneId === race.drone1Id ? race.drone2EloBefore : race.drone1EloBefore;
  const isUpset =
    race.winnerDroneId != null &&
    winnerEloBefore != null &&
    loserEloBefore != null &&
    winnerEloBefore + 50 <= loserEloBefore;

  // New track record: compare winner's time to the minimum winner time on
  // this track strictly before this race's createdAt. LEAST() picks the
  // faster of the two drone times per row; we want the min across rows.
  const winnerTimeStr = race.winnerDroneId === race.drone1Id ? race.drone1Time : race.drone2Time;
  const winnerTime = winnerTimeStr != null ? Number(winnerTimeStr) : null;

  let isNewTrackRecord = false;
  if (winnerTime != null && race.trackId) {
    // drizzle-orm/neon-http `execute()` returns { rows, fields, rowCount, ... },
    // not an iterable - destructure off .rows.
    const {
      rows: [best],
    } = await db.execute(sql`
      SELECT MIN(LEAST(drone1_time::numeric, drone2_time::numeric)) AS best_time
      FROM races
      WHERE track_id = ${race.trackId}
        AND created_at < ${race.createdAt}
        AND drone1_time IS NOT NULL
        AND drone2_time IS NOT NULL
    `);
    const prevBest = best?.best_time != null ? Number(best.best_time) : null;
    isNewTrackRecord = prevBest == null || winnerTime < prevBest;
  }

  // Head-to-head: count across either drone-slot orientation, including
  // this race (keeps the tally stable as users browse old races).
  // Restricted to completed races - PENDING shouldn't count toward h2h.
  const {
    rows: [h2hRow],
  } = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      SUM(CASE WHEN winner_drone_id = ${race.drone1Id} THEN 1 ELSE 0 END)::int AS drone1_wins,
      SUM(CASE WHEN winner_drone_id = ${race.drone2Id} THEN 1 ELSE 0 END)::int AS drone2_wins
    FROM races
    WHERE status = 'completed'
      AND ((drone1_id = ${race.drone1Id} AND drone2_id = ${race.drone2Id})
        OR (drone1_id = ${race.drone2Id} AND drone2_id = ${race.drone1Id}))
  `);
  const h2h = {
    total: h2hRow?.total ?? 0,
    drone1Wins: h2hRow?.drone1_wins ?? 0,
    drone2Wins: h2hRow?.drone2_wins ?? 0,
  };

  // Seed, snapshots and the client-safe log are public once the race is settled (SPEC.md 8).
  const settled = race.status === 'completed';
  const [batch] =
    settled && race.batchSlot !== null
      ? await db
          .select({ commitTx: batches.commitTx })
          .from(batches)
          .where(eq(batches.slot, race.batchSlot))
          .limit(1)
      : [];
  return {
    ...race,
    // The batch's commit transaction, for the browser verification (SPEC.md 11).
    commitTx: batch?.commitTx ?? null,
    seed: settled ? race.seed : null,
    snapshotA: settled ? race.snapshotA : null,
    snapshotB: settled ? race.snapshotB : null,
    log: settled ? race.log : null,
    // The settle transaction on the explorer (SPEC.md 6 `explorerTx`), once there is one.
    settleExplorerUrl: race.settleTx ? getNear().explorerTx(race.settleTx) : null,
    track: row.track,
    drone1: byId[race.drone1Id],
    drone2: byId[race.drone2Id],
    isUpset,
    isNewTrackRecord,
    h2h,
  };
}

/** Total race count (used by the races page header).
 *  When `filters.userId` is set, counts only races where one of the user's
 *  drones raced in either slot - so the header value matches the "Your
 *  Races" toggle on the races page.
 *  @param {{ userId?: string }} [filters]
 */
export async function getTotalRaceCount(filters = {}) {
  const db = database();
  // Only completed races count toward the public "total" - PENDING are
  // mid-flight and shouldn't inflate the header tally.
  if (filters.userId) {
    const userDrones = await db
      .select({ id: drones.id })
      .from(drones)
      .where(eq(drones.userId, filters.userId));
    if (userDrones.length === 0) return 0;
    const ids = userDrones.map((d) => d.id);
    const [row] = await db
      .select({ count: sql`count(*)::int` })
      .from(races)
      .where(and(eq(races.status, 'completed'), eitherSide(ids, ids)));
    return Number(row?.count ?? 0);
  }
  const [row] = await db
    .select({ count: sql`count(*)::int` })
    .from(races)
    .where(eq(races.status, 'completed'));
  return Number(row?.count ?? 0);
}

/**
 * Races where the given drone ids raced in either slot.
 * @param {string | string[]} first
 * @param {string | string[]} second
 * @returns {import('drizzle-orm').SQL}
 */
function eitherSide(first, second) {
  const clause = Array.isArray(first)
    ? or(inArray(races.drone1Id, first), inArray(races.drone2Id, /** @type {string[]} */ (second)))
    : or(eq(races.drone1Id, first), eq(races.drone2Id, /** @type {string} */ (second)));
  return /** @type {import('drizzle-orm').SQL} */ (clause);
}
