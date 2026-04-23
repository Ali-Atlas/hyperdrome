// One-off migration: upsert existing tracks to the new level-bracket /
// 1-10 difficulty shape. Matches each row by `name`. Idempotent - safe to
// re-run. Invoke with: node --env-file=.env.local lib/db/update-tracks.js
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq } from 'drizzle-orm';
import * as schema from './schema.js';

const { tracks } = schema;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const db = drizzle(neon(connectionString), { schema });

const TRACK_UPDATES = [
  { name: 'Neon Straightaway', levelMin: 1,  levelMax: 5,  difficulty: 2 },
  { name: 'The Grid',          levelMin: 1,  levelMax: 10, difficulty: 3 },
  { name: 'Circuit Alpha',     levelMin: 1,  levelMax: 10, difficulty: 4 },
  { name: 'Skyline Drift',     levelMin: 6,  levelMax: 15, difficulty: 5 },
  { name: 'Voltage Loop',      levelMin: 6,  levelMax: 20, difficulty: 7 },
  { name: 'Tempest Run',       levelMin: 11, levelMax: 20, difficulty: 9 },
  { name: 'Horizon Express',   levelMin: 1,  levelMax: 10, difficulty: 1 },
];

async function main() {
  for (const row of TRACK_UPDATES) {
    const result = await db
      .update(tracks)
      .set({
        levelMin: row.levelMin,
        levelMax: row.levelMax,
        difficulty: row.difficulty,
      })
      .where(eq(tracks.name, row.name))
      .returning({ id: tracks.id, name: tracks.name });
    console.log(
      `  ${row.name.padEnd(20)} L${row.levelMin}-${row.levelMax} diff ${row.difficulty}  -> ${result.length} row(s)`,
    );
  }
  console.log('Track migration complete.');
}

main().catch((err) => {
  console.error('Track migration failed:', err);
  process.exit(1);
});
