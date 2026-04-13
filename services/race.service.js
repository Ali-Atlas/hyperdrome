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
  const track = await getRandomTrack();
  const weather = randomWeather();
  const timeOfDay = randomTimeOfDay();

  const result = simulateRace(d1, d2, track, weather, timeOfDay);
  const winner = result.winnerId === d1.id ? d1 : d2;
  const loser = result.winnerId === d1.id ? d2 : d1;

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
    raceLog: result.raceLog,
  });

  // Update winner drone
  await db
    .update(drones)
    .set({
      wins: winner.wins + 1,
      totalRaces: winner.totalRaces + 1,
      xp: winner.xp + cfg.xpPerWin,
      eloRating: newWinnerElo,
      unspentPoints: winner.unspentPoints + pointsAwarded,
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
 * Fetch a single race with all drone + track details.
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

  const droneRows = await db
    .select()
    .from(drones)
    .where(inArray(drones.id, [row.race.drone1Id, row.race.drone2Id]));
  const byId = Object.fromEntries(droneRows.map((d) => [d.id, d]));

  return {
    ...row.race,
    track: row.track,
    drone1: byId[row.race.drone1Id],
    drone2: byId[row.race.drone2Id],
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
