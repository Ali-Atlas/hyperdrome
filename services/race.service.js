import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import {
  calculateRacePoints,
  calculateNewElo,
} from '@/lib/game-engine/economy.js';
import {
  getActiveDronesByBracket,
  matchDronesInBracket,
  ensureBotBackfill,
} from '@/lib/game-engine/matchmaking.js';
import {
  simulateRace,
  randomWeather,
  randomTimeOfDay,
} from '@/lib/game-engine/race-simulator.js';
import { getRandomTrack } from '@/services/track.service.js';
import { checkAndLevelUp } from '@/services/drone.service.js';
import { ApiError } from '@/lib/api/response.js';

const { drones, users, races, tracks, adminConfig, skins } = schema;

/* -------------------------------------------------------------------------- */
/* Config loader                                                              */
/* -------------------------------------------------------------------------- */

async function loadConfig() {
  const rows = await db.select().from(adminConfig);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const num = (key, fallback) => {
    const v = map[key];
    if (v == null) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    raceIntervalSeconds:   num('race_interval_seconds', 120),
    pointsPerWinBase:      num('points_per_win_base', 3),
    xpPerWin:              num('xp_per_win', 10),
    xpPerLoss:             num('xp_per_loss', 4),
    botDensityMinimum:     num('bot_density_minimum', 4),
    skinDropRateCommon:    num('skin_drop_rate_common', 0.05),
    skinDropRateRare:      num('skin_drop_rate_rare', 0.02),
    skinDropRateEpic:      num('skin_drop_rate_epic', 0.005),
    skinDropRateLegendary: num('skin_drop_rate_legendary', 0.001),
  };
}

/* -------------------------------------------------------------------------- */
/* Skin drops                                                                 */
/* -------------------------------------------------------------------------- */

async function rollSkinDropForWinner(userId, cfg) {
  if (!userId) return null;
  const roll = Math.random();
  let rarity = null;
  if (roll < cfg.skinDropRateLegendary) rarity = 'legendary';
  else if (roll < cfg.skinDropRateLegendary + cfg.skinDropRateEpic) rarity = 'epic';
  else if (roll < cfg.skinDropRateLegendary + cfg.skinDropRateEpic + cfg.skinDropRateRare) rarity = 'rare';
  else if (roll < cfg.skinDropRateLegendary + cfg.skinDropRateEpic + cfg.skinDropRateRare + cfg.skinDropRateCommon) rarity = 'common';
  if (!rarity) return null;

  const unowned = await db
    .select()
    .from(skins)
    .where(and(eq(skins.rarity, rarity), sql`${skins.userId} IS NULL`))
    .limit(1);
  if (unowned.length === 0) return null;

  await db
    .update(skins)
    .set({ userId })
    .where(eq(skins.id, unowned[0].id));
  return unowned[0];
}

/* -------------------------------------------------------------------------- */
/* Core race cycle                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Run one full race cycle across every bracket.
 *
 * Every active drone races every cycle. Bot backfill guarantees each
 * non-empty bracket has an even number of drones, so there are no byes.
 *
 * @returns {Promise<{ racesRun: number, botsActivated: number, bracketSummary: Record<string, number> }>}
 */
export async function runRaceCycle() {
  const cfg = await loadConfig();
  const bracketSummary = {};
  let racesRun = 0;
  let botsActivated = 0;

  const buckets = await getActiveDronesByBracket();

  for (const bracket of Object.keys(buckets)) {
    const activated = await ensureBotBackfill(
      bracket,
      buckets[bracket].length,
      cfg.botDensityMinimum,
    );
    botsActivated += activated;
  }

  // Re-fetch after backfill so we have the freshly-activated bots.
  const updatedBuckets = await getActiveDronesByBracket();

  for (const [bracket, bracketDrones] of Object.entries(updatedBuckets)) {
    if (bracketDrones.length < 2) {
      bracketSummary[bracket] = 0;
      continue;
    }
    const pairs = matchDronesInBracket(bracketDrones);
    bracketSummary[bracket] = pairs.length;

    for (const [d1, d2] of pairs) {
      await runSingleRace(d1, d2, cfg);
      racesRun += 1;
    }
  }

  return { racesRun, botsActivated, bracketSummary };
}

async function runSingleRace(d1, d2, cfg) {
  // Matchmaking guarantees d1.level === d2.level, so either drone's level
  // is the race level used to filter eligible tracks.
  const raceLevel = d1.level ?? d2.level ?? null;
  const track = await getRandomTrack(raceLevel);
  const weather = randomWeather();
  const timeOfDay = randomTimeOfDay();

  const result = simulateRace(d1, d2, track, weather, timeOfDay);
  const winner = result.winnerId === d1.id ? d1 : d2;
  const loser = result.winnerId === d1.id ? d2 : d1;

  // Snapshot pre-race ELO before we touch drones, and compute signed
  // deltas so the race-detail page can show ELO + (+N / -N) without
  // reconstructing history.
  const drone1EloBefore = d1.eloRating;
  const drone2EloBefore = d2.eloRating;

  const pointsAwarded = calculateRacePoints(
    track.difficulty,
    winner.eloRating,
    loser.eloRating,
    { basePoints: cfg.pointsPerWinBase },
  );
  const { newWinnerElo, newLoserElo } = calculateNewElo(
    winner.eloRating,
    loser.eloRating,
  );

  const drone1EloAfter = d1.id === winner.id ? newWinnerElo : newLoserElo;
  const drone2EloAfter = d2.id === winner.id ? newWinnerElo : newLoserElo;
  const drone1EloChange = drone1EloAfter - drone1EloBefore;
  const drone2EloChange = drone2EloAfter - drone2EloBefore;

  // Insert the race row
  await db.insert(races).values({
    drone1Id: d1.id,
    drone2Id: d2.id,
    trackId: track.id,
    winnerDroneId: winner.id,
    pointsAwarded,
    xpWinner: cfg.xpPerWin,
    xpLoser: cfg.xpPerLoss,
    timeOfDay,
    weather,
    drone1Time: String(result.drone1Time),
    drone2Time: String(result.drone2Time),
    drone1EloBefore,
    drone2EloBefore,
    drone1EloChange,
    drone2EloChange,
    raceLog: result.raceLog,
  });

  // Update winner drone (points are paid into the owning player's wallet
  // further down, NOT into the deprecated drones.unspent_points column).
  await db
    .update(drones)
    .set({
      wins: winner.wins + 1,
      totalRaces: winner.totalRaces + 1,
      xp: winner.xp + cfg.xpPerWin,
      eloRating: newWinnerElo,
    })
    .where(eq(drones.id, winner.id));

  // Update loser drone
  await db
    .update(drones)
    .set({
      losses: loser.losses + 1,
      totalRaces: loser.totalRaces + 1,
      xp: loser.xp + cfg.xpPerLoss,
      eloRating: newLoserElo,
    })
    .where(eq(drones.id, loser.id));

  // Update user totals (only for non-bot drones)
  if (winner.userId && !winner.isBot) {
    await db
      .update(users)
      .set({
        totalRaces: sql`${users.totalRaces} + 1`,
        totalWins: sql`${users.totalWins} + 1`,
        points: sql`${users.points} + ${pointsAwarded}`,
        seasonPoints: sql`${users.seasonPoints} + ${pointsAwarded}`,
      })
      .where(eq(users.id, winner.userId));
  }
  if (loser.userId && !loser.isBot) {
    await db
      .update(users)
      .set({ totalRaces: sql`${users.totalRaces} + 1` })
      .where(eq(users.id, loser.userId));
  }

  // Level-up checks
  await checkAndLevelUp(winner.id);
  await checkAndLevelUp(loser.id);

  // Skin drop for winner (only for non-bot owners)
  if (winner.userId && !winner.isBot) {
    await rollSkinDropForWinner(winner.userId, cfg);
  }
}

/* -------------------------------------------------------------------------- */
/* Query helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Paginated race list with optional filters.
 * @param {object} filters
 * @param {object} pagination - { page, limit }
 */
export async function getRaces(filters = {}, pagination = {}) {
  const { page = 1, limit = 20 } = pagination;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (filters.trackId) conditions.push(eq(races.trackId, filters.trackId));
  if (filters.weather) conditions.push(eq(races.weather, filters.weather));
  if (filters.timeOfDay) conditions.push(eq(races.timeOfDay, filters.timeOfDay));
  if (filters.droneId) {
    conditions.push(
      or(eq(races.drone1Id, filters.droneId), eq(races.drone2Id, filters.droneId)),
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({ race: races, track: tracks })
    .from(races)
    .leftJoin(tracks, eq(races.trackId, tracks.id))
    .where(whereClause)
    .orderBy(desc(races.createdAt))
    .limit(limit)
    .offset(offset);

  const droneIds = new Set();
  rows.forEach(({ race }) => {
    droneIds.add(race.drone1Id);
    droneIds.add(race.drone2Id);
  });
  const droneList = droneIds.size
    ? await db.select().from(drones).where(inArray(drones.id, Array.from(droneIds)))
    : [];
  const droneMap = Object.fromEntries(droneList.map((d) => [d.id, d]));

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
 *   - `isUpset` — true when the winner's pre-race ELO was >= 50 lower
 *     than the loser's.
 *   - `isNewTrackRecord` — true when this race's winning time is the
 *     fastest recorded on the track at/before it ran.
 *   - `h2h` — { total, drone1Wins, drone2Wins } across all prior +
 *     current races between the same two drones in either slot.
 *
 * @param {string} raceId
 */
export async function getRaceById(raceId) {
  const [row] = await db
    .select({ race: races, track: tracks })
    .from(races)
    .leftJoin(tracks, eq(races.trackId, tracks.id))
    .where(eq(races.id, raceId))
    .limit(1);
  if (!row) throw new ApiError('Race not found', 404);

  const race = row.race;

  const droneRows = await db
    .select()
    .from(drones)
    .where(inArray(drones.id, [race.drone1Id, race.drone2Id]));
  const byId = Object.fromEntries(droneRows.map((d) => [d.id, d]));

  // Upset: pre-race ELO gap of 50+ in the loser's favour.
  const winnerEloBefore =
    race.winnerDroneId === race.drone1Id
      ? race.drone1EloBefore
      : race.drone2EloBefore;
  const loserEloBefore =
    race.winnerDroneId === race.drone1Id
      ? race.drone2EloBefore
      : race.drone1EloBefore;
  const isUpset =
    winnerEloBefore != null &&
    loserEloBefore != null &&
    winnerEloBefore + 50 <= loserEloBefore;

  // New track record: compare winner's time to the minimum winner time on
  // this track strictly before this race's createdAt. LEAST() picks the
  // faster of the two drone times per row; we want the min across rows.
  const winnerTimeStr =
    race.winnerDroneId === race.drone1Id ? race.drone1Time : race.drone2Time;
  const winnerTime =
    winnerTimeStr != null ? Number(winnerTimeStr) : null;

  let isNewTrackRecord = false;
  if (winnerTime != null && race.trackId) {
    const [best] = await db.execute(sql`
      SELECT MIN(LEAST(drone1_time::numeric, drone2_time::numeric)) AS best_time
      FROM races
      WHERE track_id = ${race.trackId}
        AND created_at < ${race.createdAt}
        AND drone1_time IS NOT NULL
        AND drone2_time IS NOT NULL
    `);
    const prevBest =
      best?.best_time != null ? Number(best.best_time) : null;
    isNewTrackRecord = prevBest == null || winnerTime < prevBest;
  }

  // Head-to-head: count across either drone-slot orientation, including
  // this race (keeps the tally stable as users browse old races).
  const [h2hRow] = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      SUM(CASE WHEN winner_drone_id = ${race.drone1Id} THEN 1 ELSE 0 END)::int AS drone1_wins,
      SUM(CASE WHEN winner_drone_id = ${race.drone2Id} THEN 1 ELSE 0 END)::int AS drone2_wins
    FROM races
    WHERE (drone1_id = ${race.drone1Id} AND drone2_id = ${race.drone2Id})
       OR (drone1_id = ${race.drone2Id} AND drone2_id = ${race.drone1Id})
  `);
  const h2h = {
    total: h2hRow?.total ?? 0,
    drone1Wins: h2hRow?.drone1_wins ?? 0,
    drone2Wins: h2hRow?.drone2_wins ?? 0,
  };

  return {
    ...race,
    track: row.track,
    drone1: byId[race.drone1Id],
    drone2: byId[race.drone2Id],
    isUpset,
    isNewTrackRecord,
    h2h,
  };
}

/** Calculate when the next race cycle will run. */
export async function getNextRaceTime() {
  const cfg = await loadConfig();
  const [latest] = await db
    .select({ createdAt: races.createdAt })
    .from(races)
    .orderBy(desc(races.createdAt))
    .limit(1);
  const last = latest?.createdAt ?? new Date();
  const next = new Date(new Date(last).getTime() + cfg.raceIntervalSeconds * 1000);
  return next;
}

/**
 * Recent races for a single drone, newest first.
 * @param {string} droneId
 * @param {number} limit
 */
export async function getDroneRaceHistory(droneId, limit = 10) {
  return db
    .select()
    .from(races)
    .where(or(eq(races.drone1Id, droneId), eq(races.drone2Id, droneId)))
    .orderBy(desc(races.createdAt))
    .limit(limit);
}

/** Total race count (used by the races page header). */
export async function getTotalRaceCount() {
  const [row] = await db.select({ count: sql`count(*)::int` }).from(races);
  return row?.count ?? 0;
}
