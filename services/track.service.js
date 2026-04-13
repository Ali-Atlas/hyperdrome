import { db, schema } from '@/lib/db';

const { tracks } = schema;

/** Return all tracks. */
export async function getAllTracks() {
  return db.select().from(tracks);
}

/**
 * Pick a random track. Fetches all tracks and picks in-memory — fine for
 * the ~10 tracks we have.
 * @returns {Promise<object>}
 */
export async function getRandomTrack() {
  const all = await getAllTracks();
  if (all.length === 0) {
    throw new Error('No tracks seeded');
  }
  return all[Math.floor(Math.random() * all.length)];
}
