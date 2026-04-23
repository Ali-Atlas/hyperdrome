import { and, gte, lte } from 'drizzle-orm';
import { db, schema } from '@/lib/db';

const { tracks } = schema;

/** Return all tracks. */
export async function getAllTracks() {
  return db.select().from(tracks);
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
