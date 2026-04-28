#!/usr/bin/env node
/**
 * Seed every track in the game spec (16) into the `tracks` table.
 * UPSERTs by name: if a row with the same name exists, every other
 * field is overwritten; if not, the row is inserted. `image_url` is
 * derived from `name` -> lowercase + spaces-to-underscores + .webp.
 *
 * Note: the schema has no `conditions` column — the in-spec
 * "Conditions" data is informational only and not stored. Weather
 * and time-of-day are picked at race-creation time by the engine
 * (lib/game-engine/race-simulator.js#randomWeather / randomTimeOfDay).
 *
 * Run from the repo root:  node scripts/seed-all-tracks.js
 *
 * Idempotent. Re-runs UPDATE every track row to the canonical values
 * (no-op if already canonical) and never delete or change track IDs.
 * Existing `races.track_id` foreign keys are preserved.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

/* -------------------------------------------------------------------------- */
/* Track spec — 16 tracks, ordered by tier then difficulty                    */
/* -------------------------------------------------------------------------- */

const TRACKS = [
  // Tier 1 — LV 1-5
  { name: 'Horizon Express',   levelMin: 1,  levelMax: 5,  difficulty: 1,  straights: 2, turns: 2,  laps: 3, length: 'short'  },
  { name: 'Neon Straightaway', levelMin: 1,  levelMax: 5,  difficulty: 2,  straights: 3, turns: 3,  laps: 3, length: 'medium' },
  { name: 'Keyhole',           levelMin: 1,  levelMax: 5,  difficulty: 2,  straights: 2, turns: 2,  laps: 3, length: 'short'  },
  { name: 'The Grid',          levelMin: 1,  levelMax: 5,  difficulty: 3,  straights: 4, turns: 4,  laps: 3, length: 'medium' },
  // Tier 2 — LV 6-10
  { name: 'Meridian',          levelMin: 6,  levelMax: 10, difficulty: 3,  straights: 4, turns: 4,  laps: 3, length: 'medium' },
  { name: 'Circuit Alpha',     levelMin: 6,  levelMax: 10, difficulty: 4,  straights: 4, turns: 5,  laps: 3, length: 'medium' },
  { name: 'Crossfire',         levelMin: 6,  levelMax: 10, difficulty: 4,  straights: 3, turns: 5,  laps: 3, length: 'medium' },
  { name: 'Iron Ribbon',       levelMin: 6,  levelMax: 10, difficulty: 5,  straights: 4, turns: 6,  laps: 3, length: 'long'   },
  // Tier 3 — LV 11-15
  { name: 'Skyline Drift',     levelMin: 11, levelMax: 15, difficulty: 6,  straights: 3, turns: 7,  laps: 3, length: 'long'   },
  { name: 'Helix',             levelMin: 11, levelMax: 15, difficulty: 6,  straights: 2, turns: 6,  laps: 3, length: 'medium' },
  { name: 'Switchblade',       levelMin: 11, levelMax: 15, difficulty: 7,  straights: 3, turns: 8,  laps: 3, length: 'long'   },
  { name: 'Phantom Circuit',   levelMin: 11, levelMax: 15, difficulty: 7,  straights: 4, turns: 7,  laps: 3, length: 'long'   },
  // Tier 4 — LV 16-20
  { name: 'Voltage Loop',      levelMin: 16, levelMax: 20, difficulty: 8,  straights: 4, turns: 8,  laps: 3, length: 'long'   },
  { name: 'Obsidian Maze',     levelMin: 16, levelMax: 20, difficulty: 9,  straights: 3, turns: 9,  laps: 3, length: 'long'   },
  { name: 'Apex Descent',      levelMin: 16, levelMax: 20, difficulty: 9,  straights: 2, turns: 10, laps: 3, length: 'long'   },
  { name: 'Tempest Run',       levelMin: 16, levelMax: 20, difficulty: 10, straights: 2, turns: 8,  laps: 3, length: 'long'   },
];

function imagePathFor(name) {
  return `/tracks/${name.toLowerCase().trim().replace(/\s+/g, '_')}.webp`;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  let inserted = 0;
  let updated = 0;

  for (const t of TRACKS) {
    const imageUrl = imagePathFor(t.name);
    const [existing] = await sql`
      SELECT id FROM tracks WHERE name = ${t.name} LIMIT 1
    `;

    if (existing) {
      await sql`
        UPDATE tracks
        SET level_min = ${t.levelMin},
            level_max = ${t.levelMax},
            difficulty = ${t.difficulty},
            straights = ${t.straights},
            turns = ${t.turns},
            laps = ${t.laps},
            length = ${t.length},
            image_url = ${imageUrl}
        WHERE id = ${existing.id}
      `;
      updated += 1;
      console.log(
        `  UPDATE  ${t.name.padEnd(20)}  L${t.levelMin}-${t.levelMax}  diff ${t.difficulty}  ${t.straights}S/${t.turns}T  ${t.length.padEnd(6)}  ${imageUrl}`,
      );
    } else {
      await sql`
        INSERT INTO tracks (name, level_min, level_max, difficulty, straights, turns, laps, length, image_url)
        VALUES (
          ${t.name},
          ${t.levelMin},
          ${t.levelMax},
          ${t.difficulty},
          ${t.straights},
          ${t.turns},
          ${t.laps},
          ${t.length},
          ${imageUrl}
        )
      `;
      inserted += 1;
      console.log(
        `  INSERT  ${t.name.padEnd(20)}  L${t.levelMin}-${t.levelMax}  diff ${t.difficulty}  ${t.straights}S/${t.turns}T  ${t.length.padEnd(6)}  ${imageUrl}`,
      );
    }
  }

  console.log(`\nresult: ${inserted} inserted, ${updated} updated`);

  // Final tally
  const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM tracks`;
  console.log(`tracks table now has ${total} row(s) total`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
