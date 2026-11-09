import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';

const { users, drones, skins, seasons, races, teams } = schema;

/* -------------------------------------------------------------------------- */
/* Players                                                                    */
/* -------------------------------------------------------------------------- */

const PLAYER_SORT_COLS = {
  elo: users.eloRating,
  wins: users.totalWins,
  season_points: users.seasonPoints,
  total_races: users.totalRaces,
};

/* Lifetime "earned" volts for a player: current wallet balance plus
   everything they've reinvested into stat upgrades on their drones.
   Genuine lifetime totals would also include volts spent on packs /
   marketplace / mod-binding fees - those leave no trail on `users`
   or `drones` so we treat this as a lower-bound proxy, which is what
   the captain's spec calls for ("current balance + what they've
   spent"). Implemented as a correlated subquery so the leaderboard
   query can SELECT + ORDER BY on it without an extra round trip. */
const PLAYER_EARNED_VOLTS_SQL = sql`(${users.points} + COALESCE((
  SELECT SUM(${drones.totalPointsInvested})
  FROM ${drones}
  WHERE ${drones.userId} = ${users.id}
), 0))::int`;

/**
 * Ranked player leaderboard.
 * @param {'elo'|'wins'|'season_points'|'earned'|'total_races'|'win_rate'} sortBy
 * @param {number} limit
 * @param {number} offset
 * @param {object} [options]
 * @param {'asc'|'desc'} [options.sortOrder='desc']
 */
export async function getPlayerLeaderboard(sortBy = 'elo', limit = 50, offset = 0, options = {}) {
  const sortOrder = options.sortOrder === 'asc' ? 'asc' : 'desc';
  const dir = sortOrder === 'asc' ? asc : desc;

  const baseSelect = {
    id: users.id,
    username: users.username,
    image: users.image,
    points: users.points,
    eloRating: users.eloRating,
    seasonPoints: users.seasonPoints,
    totalRaces: users.totalRaces,
    totalWins: users.totalWins,
    earned: PLAYER_EARNED_VOLTS_SQL,
  };

  // `id ASC` tiebreaker on every sort variant guarantees a stable, total
  // ordering — without it, rows that tie on the primary sort key can
  // shuffle between pages and the user's footer rank (computed by
  // getUserRank, which counts everyone strictly ahead under the same
  // tiebreaker) drifts away from their actual table row.
  if (sortBy === 'win_rate') {
    const winRateExpr = sql`(CASE WHEN ${users.totalRaces} > 0 THEN (${users.totalWins}::float / ${users.totalRaces}::float) ELSE 0 END)`;
    return db
      .select({
        ...baseSelect,
        winRate: winRateExpr,
      })
      .from(users)
      .where(gte(users.totalRaces, 1))
      .orderBy(
        sortOrder === 'asc' ? sql`${winRateExpr} ASC` : sql`${winRateExpr} DESC`,
        asc(users.id)
      )
      .limit(limit)
      .offset(offset);
  }

  const orderClause =
    sortBy === 'earned'
      ? sortOrder === 'asc'
        ? sql`${PLAYER_EARNED_VOLTS_SQL} ASC`
        : sql`${PLAYER_EARNED_VOLTS_SQL} DESC`
      : dir(PLAYER_SORT_COLS[sortBy] ?? users.eloRating);

  return db
    .select(baseSelect)
    .from(users)
    .orderBy(orderClause, asc(users.id))
    .limit(limit)
    .offset(offset);
}

/* -------------------------------------------------------------------------- */
/* Drones                                                                     */
/* -------------------------------------------------------------------------- */

const DRONE_SORT_COLS = {
  elo: drones.eloRating,
  wins: drones.wins,
  total_races: drones.totalRaces,
  level: drones.level,
};

/* Lifetime volts earned BY this drone across completed races. Winner
   gets `points_awarded`; loser gets `loser_points_awarded` (nullable on
   pre-column rows - coalesce to 0). Correlated subquery so the
   leaderboard query can SELECT + ORDER BY on it without joining +
   grouping a separate aggregate. The `races` table is indexed on
   drone1_id / drone2_id / winner_drone_id so the per-row lookup is
   cheap even on the 100-row leaderboard pages. */
const DRONE_EARNED_VOLTS_SQL = sql`COALESCE((
  SELECT SUM(
    CASE
      WHEN ${races.winnerDroneId} = ${drones.id} THEN ${races.pointsAwarded}
      ELSE COALESCE(${races.loserPointsAwarded}, 0)
    END
  )
  FROM ${races}
  WHERE ${races.status} = 'completed'
    AND (${races.drone1Id} = ${drones.id} OR ${races.drone2Id} = ${drones.id})
), 0)::int`;

/* Same shape as DRONE_EARNED_VOLTS_SQL but gated to races created
   on/after the active season's start date. Mirrors the player-side
   `users.season_points` semantics (volts won this season only) so the
   drone podium can render a "Season" stat alongside the player podium.
   When no season is active the inner SELECT returns NULL, the
   `created_at >= NULL` predicate evaluates to UNKNOWN (no rows match),
   and the SUM coalesces to 0 - which is the right fallback. */
const DRONE_SEASON_EARNED_VOLTS_SQL = sql`COALESCE((
  SELECT SUM(
    CASE
      WHEN ${races.winnerDroneId} = ${drones.id} THEN ${races.pointsAwarded}
      ELSE COALESCE(${races.loserPointsAwarded}, 0)
    END
  )
  FROM ${races}
  WHERE ${races.status} = 'completed'
    AND (${races.drone1Id} = ${drones.id} OR ${races.drone2Id} = ${drones.id})
    AND ${races.createdAt} >= (
      SELECT ${seasons.startDate} FROM ${seasons}
      WHERE ${seasons.isActive} = true
      LIMIT 1
    )
), 0)::int`;

/* Bracket bucket: 1 = LV1-5, 2 = LV6-10, 3 = LV11-15, 4 = LV16-20.
   Used as the window-function partition key when computing the per-
   bracket average ELO. */
const BRACKET_BUCKET_SQL = sql`(CASE
  WHEN ${drones.level} BETWEEN 1 AND 5 THEN 1
  WHEN ${drones.level} BETWEEN 6 AND 10 THEN 2
  WHEN ${drones.level} BETWEEN 11 AND 15 THEN 3
  ELSE 4
END)`;

/* Bracket weight applied to the rating so higher tiers can outrank lower
   tiers on the all-levels board even when bracket-relative dominance is
   comparable. Captain spec: T1=1.0, T2=1.3, T3=1.7, T4=2.0. */
const BRACKET_WEIGHT_SQL = sql`(CASE
  WHEN ${drones.level} BETWEEN 1 AND 5 THEN 1.0
  WHEN ${drones.level} BETWEEN 6 AND 10 THEN 1.3
  WHEN ${drones.level} BETWEEN 11 AND 15 THEN 1.7
  WHEN ${drones.level} BETWEEN 16 AND 20 THEN 2.0
END)`;

/* Rating = dominance × experience × bracketWeight, rounded.
   - dominance    = drone.elo - AVG(elo) over the same level bracket
                    (positive = above the bracket mean, negative = below)
   - experience   = 1 + log10(GREATEST(total_races, 1)) / 3
                    (1.0× at <=1 races, 1.33× at 10, 1.67× at 100, 2.0× at 1k)
   - bracketWeight = 1.0 / 1.3 / 1.7 / 2.0 across T1..T4 so a strong
                     T4 drone outranks a strong T1 drone on the merged board.
   Computed in a single SQL expression with a window function so the DB
   can produce + sort the column without us pulling everything into JS.
   PostgreSQL's `LOG()` defaults to base 10, matching JS Math.log10. */
const RATING_SQL = sql`ROUND(
  (${drones.eloRating}::float
    - AVG(${drones.eloRating}::float) OVER (PARTITION BY ${BRACKET_BUCKET_SQL}))
  * (1 + LOG(GREATEST(${drones.totalRaces}, 1)::numeric) / 3)
  * ${BRACKET_WEIGHT_SQL}
)::int`;

/**
 * Ranked drone leaderboard.
 *
 * @param {string} sortBy          'elo'|'rating'|'wins'|'total_races'|'level'|'earned'|'win_rate'
 * @param {number} limit
 * @param {number} offset
 * @param {object} [filters]
 * @param {boolean} [filters.includeBots=false]  include bot drones in the results
 * @param {[number, number]} [filters.bracket]   inclusive level range, e.g. [6, 10]
 * @param {'asc'|'desc'} [filters.sortOrder='desc']
 */
export async function getDroneLeaderboard(sortBy = 'elo', limit = 50, offset = 0, filters = {}) {
  const { includeBots = false, bracket } = filters;
  const sortOrder = filters.sortOrder === 'asc' ? 'asc' : 'desc';
  const dir = sortOrder === 'asc' ? asc : desc;

  const conditions = [];
  if (!includeBots) conditions.push(eq(drones.isBot, false));
  if (Array.isArray(bracket) && bracket.length === 2) {
    const [lo, hi] = bracket;
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      conditions.push(gte(drones.level, lo));
      conditions.push(lte(drones.level, hi));
    }
  }

  // Common select shape with the equipped-skin join. The join lets the
  // podium card pick up the legendary frame + getDroneImage render the
  // legendary artwork (when applicable) without an extra round trip.
  // `rating` (bracket-relative dominance × experience), `earned`
  // (lifetime volts won across completed races), and `seasonEarned`
  // (volts won since the active season started - drone analogue of
  // `users.seasonPoints`) are computed in every variant so the
  // leaderboard table + podium render those without extra round trips.
  const baseSelect = {
    drone: drones,
    appliedSkin: skins,
    rating: RATING_SQL,
    earned: DRONE_EARNED_VOLTS_SQL,
    seasonEarned: DRONE_SEASON_EARNED_VOLTS_SQL,
    teamName: teams.name,
  };

  const shape = (rows) =>
    rows.map(({ drone, appliedSkin, rating, earned, seasonEarned, teamName }) => ({
      ...drone,
      appliedSkin,
      teamName,
      rating: rating != null ? Number(rating) : null,
      earned: earned != null ? Number(earned) : 0,
      seasonEarned: seasonEarned != null ? Number(seasonEarned) : 0,
    }));

  if (sortBy === 'win_rate') {
    conditions.push(gte(drones.totalRaces, 1));
    const winRateExpr = sql`(CASE WHEN ${drones.totalRaces} > 0 THEN (${drones.wins}::float / ${drones.totalRaces}::float) ELSE 0 END)`;
    const rows = await db
      .select({
        ...baseSelect,
        winRate: winRateExpr,
      })
      .from(drones)
      .leftJoin(skins, eq(drones.appliedSkinId, skins.id))
      .leftJoin(teams, eq(teams.userId, drones.userId))
      .where(and(...conditions))
      .orderBy(sortOrder === 'asc' ? sql`${winRateExpr} ASC` : sql`${winRateExpr} DESC`)
      .limit(limit)
      .offset(offset);
    return rows.map((r) => ({
      ...r.drone,
      appliedSkin: r.appliedSkin,
      rating: r.rating != null ? Number(r.rating) : null,
      earned: r.earned != null ? Number(r.earned) : 0,
      seasonEarned: r.seasonEarned != null ? Number(r.seasonEarned) : 0,
      winRate: r.winRate,
    }));
  }

  // `rating` and `earned` sort by their SQL expressions directly. Other
  // sort keys map through DRONE_SORT_COLS to a literal column.
  let orderClause;
  if (sortBy === 'rating') {
    orderClause = sortOrder === 'asc' ? sql`${RATING_SQL} ASC` : sql`${RATING_SQL} DESC`;
  } else if (sortBy === 'earned') {
    orderClause =
      sortOrder === 'asc'
        ? sql`${DRONE_EARNED_VOLTS_SQL} ASC`
        : sql`${DRONE_EARNED_VOLTS_SQL} DESC`;
  } else {
    orderClause = dir(DRONE_SORT_COLS[sortBy] ?? drones.eloRating);
  }

  const rows = await db
    .select(baseSelect)
    .from(drones)
    .leftJoin(skins, eq(drones.appliedSkinId, skins.id))
    .leftJoin(teams, eq(teams.userId, drones.userId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(orderClause)
    .limit(limit)
    .offset(offset);
  return shape(rows);
}

/* -------------------------------------------------------------------------- */
/* Rank + season                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Current user's player rank (1-indexed), sorted by ELO with `id ASC`
 * as the tiebreaker — matches the player leaderboard table's
 * `ORDER BY eloRating DESC, id ASC`. A user is "ahead" if their ELO is
 * strictly higher, OR their ELO is equal and their id sorts earlier;
 * the rank is the count of users ahead, plus one. Without the id
 * tiebreaker, ELO-tied rows can land on either side of the current user
 * across pages, so the footer "Your Rank" would not match the row's
 * actual position in the table.
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
    .where(
      sql`${users.eloRating} > ${row.eloRating}
        OR (${users.eloRating} = ${row.eloRating} AND ${users.id} < ${userId})`
    );
  return (count?.count ?? 0) + 1;
}

/** Currently active season. */
export async function getSeasonInfo() {
  const [row] = await db.select().from(seasons).where(eq(seasons.isActive, true)).limit(1);
  return row ?? null;
}
