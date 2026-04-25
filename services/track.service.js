import { and, gte, lte, eq } from 'drizzle-orm';
import { db, sql as raw, schema } from '@/lib/db';

const { tracks } = schema;

/** Return all tracks. */
export async function getAllTracks() {
  return db.select().from(tracks);
}

/** Return a single track by id, or null if not found. */
export async function getTrackById(trackId) {
  const [row] = await db
    .select()
    .from(tracks)
    .where(eq(tracks.id, trackId))
    .limit(1);
  return row ?? null;
}

/**
 * Aggregate stats for a track: total races, average winning time,
 * best (fastest) winning time with the drone that set it, and the most
 * common weather/time-of-day combo on the track.
 *
 * Uses raw SQL because Drizzle's neon-http adapter has no transaction
 * layer and these are read-only aggregates.
 */
export async function getTrackStats(trackId) {
  const [agg] = await raw`
    SELECT
      COUNT(*)::int AS total_races,
      AVG(CASE
        WHEN winner_drone_id = drone1_id THEN drone1_time
        WHEN winner_drone_id = drone2_id THEN drone2_time
      END)::float AS avg_winning_time
    FROM races
    WHERE track_id = ${trackId} AND winner_drone_id IS NOT NULL
  `;

  const [best] = await raw`
    SELECT
      LEAST(r.drone1_time, r.drone2_time)::float AS best_time,
      d.name AS drone_name,
      r.created_at AS set_at
    FROM races r
    LEFT JOIN drones d ON d.id = r.winner_drone_id
    WHERE r.track_id = ${trackId} AND r.winner_drone_id IS NOT NULL
    ORDER BY LEAST(r.drone1_time, r.drone2_time) ASC
    LIMIT 1
  `;

  const [condition] = await raw`
    SELECT weather, time_of_day, COUNT(*)::int AS n
    FROM races
    WHERE track_id = ${trackId}
    GROUP BY weather, time_of_day
    ORDER BY n DESC
    LIMIT 1
  `;

  return {
    totalRaces: agg?.total_races ?? 0,
    avgWinningTime: agg?.avg_winning_time ?? null,
    bestTime: best?.best_time ?? null,
    bestTimeDrone: best?.drone_name ?? null,
    bestTimeDate: best?.set_at ?? null,
    topCondition: condition
      ? { weather: condition.weather, timeOfDay: condition.time_of_day, count: condition.n }
      : null,
  };
}

/**
 * Top 5 drones by win rate on a given track. Only drones with >= 3 races
 * on the track qualify so a single lucky win doesn't top the board.
 */
export async function getTopPerformersOnTrack(trackId) {
  const rows = await raw`
    WITH participated AS (
      SELECT drone1_id AS drone_id, winner_drone_id FROM races WHERE track_id = ${trackId}
      UNION ALL
      SELECT drone2_id AS drone_id, winner_drone_id FROM races WHERE track_id = ${trackId}
    )
    SELECT
      d.id,
      d.name,
      d.level,
      COUNT(*)::int AS races,
      COUNT(*) FILTER (WHERE p.winner_drone_id = p.drone_id)::int AS wins
    FROM participated p
    JOIN drones d ON d.id = p.drone_id
    GROUP BY d.id, d.name, d.level
    HAVING COUNT(*) >= 3
    ORDER BY (COUNT(*) FILTER (WHERE p.winner_drone_id = p.drone_id)::float / COUNT(*)) DESC,
             COUNT(*) DESC
    LIMIT 5
  `;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    level: r.level,
    races: r.races,
    wins: r.wins,
    losses: r.races - r.wins,
    winRate: r.races > 0 ? r.wins / r.races : 0,
  }));
}

/** Last 10 COMPLETED races on a track with both drone names + winner + conditions.
 *  PENDING races are excluded - they have no winner / times so they
 *  would render as broken rows in the recent-races table. */
export async function getRecentRacesOnTrack(trackId) {
  const rows = await raw`
    SELECT
      r.id,
      r.created_at AS at,
      r.winner_drone_id,
      r.weather,
      r.time_of_day,
      r.points_awarded,
      r.drone1_time::float AS drone1_time,
      r.drone2_time::float AS drone2_time,
      d1.id AS drone1_id,
      d1.name AS drone1_name,
      d2.id AS drone2_id,
      d2.name AS drone2_name
    FROM races r
    JOIN drones d1 ON d1.id = r.drone1_id
    JOIN drones d2 ON d2.id = r.drone2_id
    WHERE r.track_id = ${trackId} AND r.status = 'completed'
    ORDER BY r.created_at DESC
    LIMIT 10
  `;
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    winnerDroneId: r.winner_drone_id,
    weather: r.weather,
    timeOfDay: r.time_of_day,
    pointsAwarded: r.points_awarded,
    drone1: { id: r.drone1_id, name: r.drone1_name, time: r.drone1_time },
    drone2: { id: r.drone2_id, name: r.drone2_name, time: r.drone2_time },
  }));
}

/**
 * Pick a random track eligible for the given drone level.
 *
 * A track is eligible when `level_min <= level <= level_max`. If no
 * level is supplied or nothing matches, falls back to any track so
 * upstream callers never break on missing data.
 *
 * @param {number} [level]
 * @returns {Promise<object>}
 */
export async function getRandomTrack(level) {
  let eligible = [];
  if (typeof level === 'number' && Number.isFinite(level)) {
    eligible = await db
      .select()
      .from(tracks)
      .where(and(lte(tracks.levelMin, level), gte(tracks.levelMax, level)));
  }
  if (eligible.length === 0) {
    eligible = await getAllTracks();
  }
  if (eligible.length === 0) {
    throw new Error('No tracks seeded');
  }
  return eligible[Math.floor(Math.random() * eligible.length)];
}
