#!/usr/bin/env node
/**
 * Build out HELLO's legendary collection: bind every image-backed legendary
 * skin EXCEPT one to EVERY HELLO drone via `drone_skins (is_equipped=false)`.
 * The single excluded skin is owned by HELLO (`skins.user_id = HELLO`) but
 * has no `drone_skins` rows — that's the manual-bind QA target.
 *
 * What this script does NOT do:
 *   - Never sets / changes `drones.applied_skin_id`.
 *   - Never sets `is_equipped = true` on a new pair. Existing pairs that
 *     already have `is_equipped = true` are LEFT ALONE (ON CONFLICT DO
 *     NOTHING preserves their flag).
 *
 * "Excluded" picked deterministically as the last legendary by
 * `created_at ASC, id ASC` so re-runs always pick the same skin.
 *
 * Run from the repo root:
 *   node scripts/bind-all-legendaries-to-every-hello-drone.js
 *
 * Idempotent. Re-runs:
 *   - keep the same skin excluded (deterministic ordering),
 *   - skip any pair already in `drone_skins` (ON CONFLICT DO NOTHING),
 *   - re-home `skins.user_id` for every legendary (excluded included),
 *   - defensively delete any `drone_skins` rows for the excluded skin so
 *     it stays fully unbound regardless of prior state.
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
  const [hello] = await sql`SELECT id FROM users WHERE username = 'HELLO'`;
  if (!hello) {
    console.error('HELLO user not found');
    process.exit(1);
  }
  console.log(`HELLO user id: ${hello.id}`);

  const legendaries = await sql`
    SELECT id, name, image_url
    FROM skins
    WHERE rarity = 'legendary'
      AND image_url LIKE '/skins/%'
      AND image_url LIKE '%.webp'
    ORDER BY created_at ASC, id ASC
  `;
  console.log(`\nfound ${legendaries.length} image-backed legendary skins:`);
  for (const s of legendaries) console.log(`  ${s.name}`);

  if (legendaries.length === 0) {
    console.log('nothing to do');
    return;
  }

  const drones = await sql`
    SELECT id, name, level, elo_rating
    FROM drones
    WHERE user_id = ${hello.id}
    ORDER BY elo_rating DESC, id ASC
  `;
  console.log(`\nHELLO has ${drones.length} drones:`);
  for (const d of drones) {
    console.log(`  ${d.name} (Lv ${d.level}, ELO ${d.elo_rating})`);
  }

  if (drones.length === 0) {
    console.error('HELLO has no drones; nothing to bind to');
    process.exit(1);
  }

  const toBind = legendaries.slice(0, -1);
  const excluded = legendaries[legendaries.length - 1];
  console.log(
    `\nbinding ${toBind.length} legendaries to all ${drones.length} drones; leaving "${excluded.name}" (${excluded.id}) unbound for QA`,
  );

  // ----- Excluded skin: owned by HELLO, force fully unbound -----
  const releasedRows = await sql`
    DELETE FROM drone_skins WHERE skin_id = ${excluded.id} RETURNING drone_id
  `;
  if (releasedRows.length > 0) {
    console.log(
      `\n  released ${releasedRows.length} prior drone_skins row(s) for the excluded skin`,
    );
  }
  await sql`UPDATE skins SET user_id = ${hello.id} WHERE id = ${excluded.id}`;

  // ----- All other legendaries: re-home + bind to every drone, never equipped -----
  let newPairs = 0;
  let existingPairs = 0;

  for (const skin of toBind) {
    await sql`UPDATE skins SET user_id = ${hello.id} WHERE id = ${skin.id}`;
    for (const drone of drones) {
      const inserted = await sql`
        INSERT INTO drone_skins (drone_id, skin_id, is_equipped)
        VALUES (${drone.id}, ${skin.id}, false)
        ON CONFLICT (drone_id, skin_id) DO NOTHING
        RETURNING id
      `;
      if (inserted.length === 1) {
        newPairs += 1;
      } else {
        existingPairs += 1;
      }
    }
  }

  console.log(
    `\nbindings: ${newPairs} new (is_equipped=false), ${existingPairs} already-existing (left as-is)`,
  );

  // ----- Reporting -----

  console.log('\n--- per-skin x drone state ---');
  for (const skin of toBind) {
    const rows = await sql`
      SELECT d.name AS drone_name, ds.is_equipped, d.applied_skin_id = ${skin.id} AS is_applied
      FROM drone_skins ds
      JOIN drones d ON d.id = ds.drone_id
      WHERE ds.skin_id = ${skin.id}
        AND d.user_id = ${hello.id}
      ORDER BY d.elo_rating DESC, d.id ASC
    `;
    const equipped = rows.filter((r) => r.is_equipped).map((r) => r.drone_name);
    const applied = rows.filter((r) => r.is_applied).map((r) => r.drone_name);
    console.log(
      `  ${skin.name}: bound to ${rows.length}/${drones.length} HELLO drones` +
        (equipped.length > 0 ? ` (is_equipped=true on: ${equipped.join(', ')})` : '') +
        (applied.length > 0 ? ` (applied_skin_id on: ${applied.join(', ')})` : ''),
    );
  }

  const excludedRows = await sql`
    SELECT COUNT(*)::int AS n FROM drone_skins WHERE skin_id = ${excluded.id}
  `;
  const [{ user_id: excludedOwner }] = await sql`
    SELECT user_id FROM skins WHERE id = ${excluded.id}
  `;
  console.log(
    `\n  EXCLUDED ${excluded.name}: drone_skins rows = ${excludedRows[0].n}, skins.user_id = ${excludedOwner ?? 'NULL'}`,
  );
  if (excludedRows[0].n === 0 && excludedOwner === hello.id) {
    console.log('  -> OK: owned by HELLO, not bound to any drone');
  } else {
    console.log('  -> WARN: state does not match expected (owned-by-HELLO, no bindings)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
