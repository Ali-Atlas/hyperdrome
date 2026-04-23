import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';

const { users, drones, seasons } = schema;

/* -------------------------------------------------------------------------- */
/* Players                                                                    */
/* -------------------------------------------------------------------------- */

const PLAYER_SORT_COLS = {
  elo:            users.eloRating,
  wins:           users.totalWins,
  season_points:  users.seasonPoints,
  total_races:    users.totalRaces,
};

/**
 * Ranked player leaderboard.
 * @param {'elo'|'wins'|'season_points'|'total_races'|'win_rate'} sortBy
 * @param {number} limit
 * @param {number} offset
 */
export async function getPlayerLeaderboard(sortBy = 'elo', limit = 50, offset = 0) {
  if (sortBy === 'win_rate') {
    return db
      .select({
        id: users.id,
        username: users.username,
        image: users.image,
        points: users.points,
        eloRating: users.eloRating,
        seasonPoints: users.seasonPoints,
        totalRaces: users.totalRaces,
        totalWins: users.totalWins,
        winRate: sql`CASE WHEN ${users.totalRaces} > 0 THEN (${users.totalWins}::float / ${users.totalRaces}::float) ELSE 0 END`,
      })
      .from(users)
      .where(gte(users.totalRaces, 1))
      .orderBy(sql`(CASE WHEN ${users.totalRaces} > 0 THEN (${users.totalWins}::float / ${users.totalRaces}::float) ELSE 0 END) DESC`)
      .limit(limit)
      .offset(offset);
  }

  const col = PLAYER_SORT_COLS[sortBy] ?? users.eloRating;
  return db
    .select({
      id: users.id,
      username: users.username,
      image: users.image,
      points: users.points,
      eloRating: users.eloRating,
      seasonPoints: users.seasonPoints,
      totalRaces: users.totalRaces,
      totalWins: users.totalWins,
    })
    .from(users)
    .orderBy(desc(col))
    .limit(limit)
    .offset(offset);
}

/* -------------------------------------------------------------------------- */
/* Drones                                                                     */
/* -------------------------------------------------------------------------- */

const DRONE_SORT_COLS = {
  elo:         drones.eloRating,
  wins:        drones.wins,
  total_races: drones.totalRaces,
  level:       drones.level,
};

/**
 * Ranked drone leaderboard.
 *
 * @param {string} sortBy          'elo'|'wins'|'total_races'|'level'|'win_rate'
 * @param {number} limit
 * @param {number} offset
 * @param {object} [filters]
 * @param {boolean} [filters.includeBots=false]  include bot drones in the results
 * @param {[number, number]} [filters.bracket]   inclusive level range, e.g. [6, 10]
 */
export async function getDroneLeaderboard(
  sortBy = 'elo',
  limit = 50,
  offset = 0,
  filters = {},
) {
  const { includeBots = false, bracket } = filters;

  const conditions = [];
  if (!includeBots) conditions.push(eq(drones.isBot, false));
  if (Array.isArray(bracket) && bracket.length === 2) {
    const [lo, hi] = bracket;
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      conditions.push(gte(drones.level, lo));
      conditions.push(lte(drones.level, hi));
    }
  }

  if (sortBy === 'win_rate') {
    conditions.push(gte(drones.totalRaces, 1));
    return db
      .select({
        id: drones.id,
        name: drones.name,
        userId: drones.userId,
        isBot: drones.isBot,
        level: drones.level,
        eloRating: drones.eloRating,
        wins: drones.wins,
        losses: drones.losses,
        totalRaces: drones.totalRaces,
        imageUrl: drones.imageUrl,
        winRate: sql`CASE WHEN ${drones.totalRaces} > 0 THEN (${drones.wins}::float / ${drones.totalRaces}::float) ELSE 0 END`,
      })
      .from(drones)
      .where(and(...conditions))
      .orderBy(sql`(CASE WHEN ${drones.totalRaces} > 0 THEN (${drones.wins}::float / ${drones.totalRaces}::float) ELSE 0 END) DESC`)
      .limit(limit)
      .offset(offset);
  }

  const col = DRONE_SORT_COLS[sortBy] ?? drones.eloRating;
  return db
    .select({
      id: drones.id,
      name: drones.name,
      userId: drones.userId,
      isBot: drones.isBot,
      level: drones.level,
      eloRating: drones.eloRating,
      wins: drones.wins,
      losses: drones.losses,
      totalRaces: drones.totalRaces,
      imageUrl: drones.imageUrl,
    })
    .from(drones)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(col))
    .limit(limit)
    .offset(offset);
}

/* -------------------------------------------------------------------------- */
/* Rank + season                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Current user's player rank (1-indexed), sorted by ELO.
 * @param {string} userId
 */
export async function getUserRank(userId) {
  const [row] = await db
    .select({ eloRating: users.eloRating })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  const [count] = await db
    .select({ count: sql`count(*)::int` })
    .from(users)
    .where(sql`${users.eloRating} > ${row.eloRating}`);
  return (count?.count ?? 0) + 1;
}

/** Currently active season. */
export async function getSeasonInfo() {
  const [row] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.isActive, true))
    .limit(1);
  return row ?? null;
}
