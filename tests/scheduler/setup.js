/**
 * Setup shared by the scheduler tests: the track rows the commit phase picks from.
 */
import { schema } from '../../lib/db/index.js';
import { TRACKS } from '../../lib/game-engine/tracks.js';

const { tracks } = schema;

/**
 * Insert the SPEC.md 2.9 tracks that the database does not have yet, matched by name.
 * @param {any} db
 */
export async function seedTracks(db) {
  /** @type {{ name: string }[]} */
  const rows = await db.select({ name: tracks.name }).from(tracks);
  const existing = new Set(rows.map((t) => t.name));
  const missing = TRACKS.filter((t) => !existing.has(t.name));
  if (missing.length === 0) return;
  await db.insert(tracks).values(
    missing.map((t) => ({
      name: t.name,
      straights: t.straights,
      turns: t.turns,
      difficulty: t.difficulty,
      levelMin: t.minLevel,
      levelMax: t.maxLevel,
      length: t.length,
      imageUrl: `/tracks/${t.name.toLowerCase().replace(/ /g, '_')}.webp`,
    }))
  );
}
