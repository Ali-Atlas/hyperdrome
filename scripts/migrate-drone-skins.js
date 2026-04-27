#!/usr/bin/env node
/**
 * Backfill drone_skins rows from existing drones.applied_skin_id pointers.
 *
 * Run from the repo root:  node scripts/migrate-drone-skins.js
 *
 * Idempotent. For every drone with a non-null applied_skin_id, insert a
 * (drone_id, skin_id, is_equipped=true) row. The unique constraint on
 * (drone_id, skin_id) guards re-runs; ON CONFLICT DO NOTHING makes the
 * statement a no-op when the binding already exists.
 *
 * Run AFTER `npx drizzle-kit push` has created the drone_skins table.
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

async function main() {
  const before =
    await sql`SELECT COUNT(*)::int AS n FROM drone_skins`;
  console.log(`drone_skins rows before: ${before[0].n}`);

  const candidates = await sql`
    SELECT id, applied_skin_id FROM drones
    WHERE applied_skin_id IS NOT NULL
  `;
  console.log(`drones with applied_skin_id: ${candidates.length}`);

  const inserted = await sql`
    INSERT INTO drone_skins (drone_id, skin_id, is_equipped)
    SELECT id, applied_skin_id, true
    FROM drones
    WHERE applied_skin_id IS NOT NULL
    ON CONFLICT (drone_id, skin_id) DO NOTHING
    RETURNING drone_id
  `;

  const after =
    await sql`SELECT COUNT(*)::int AS n FROM drone_skins`;
  console.log(`drone_skins rows after: ${after[0].n}`);
  console.log(`inserted=${inserted.length} skipped=${candidates.length - inserted.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
