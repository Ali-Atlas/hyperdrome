#!/usr/bin/env node
/**
 * Bind every image-backed legendary skin EXCEPT the last one to HELLO's
 * drones for manual border/background QA. The single "last" legendary
 * (deterministic by created_at ASC, id ASC) stays unbound (skins.user_id
 * NULL, no drone_skins row) so HELLO can test the manual binding flow.
 *
 * Inserted drone_skins rows are NEVER auto-equipped (is_equipped = false)
 * and drones.applied_skin_id is NEVER changed — HELLO swaps manually to
 * inspect each legendary's treatment.
 *
 * Run from repo root:  node scripts/bind-hello-legendaries-except-one.js
 *
 * Idempotent. Re-running:
 *   - keeps the same "last" skin unbound (deterministic ordering),
 *   - skips any legendary already bound to a HELLO drone (keeps the pair),
 *   - skips any legendary bound to a non-HELLO drone (does not steal it),
 *   - re-homes ownership to HELLO for every binding it performs.
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

  const drones = await sql`
    SELECT id, name, level, elo_rating
    FROM drones
    WHERE user_id = ${hello.id}
    ORDER BY elo_rating DESC, id ASC
  `;
  if (drones.length === 0) {
    console.error('HELLO has no drones; nothing to bind to');
    process.exit(1);
  }
  console.log(`HELLO has ${drones.length} drones`);

  const legendaries = await sql`
    SELECT id, name, image_url, user_id
    FROM skins
    WHERE rarity = 'legendary'
      AND image_url LIKE '/skins/%'
      AND image_url LIKE '%.webp'
    ORDER BY created_at ASC, id ASC
  `;
  console.log(`found ${legendaries.length} image-backed legendary skins`);
  if (legendaries.length === 0) {
    console.log('nothing to do');
    return;
  }
  if (legendaries.length === 1) {
    console.log('only one legendary present — leaving it unbound; nothing to bind');
  }

  const toBind = legendaries.slice(0, -1);
  const unbound = legendaries[legendaries.length - 1];
  console.log(
    `will bind ${toBind.length} legendaries; leaving "${unbound.name}" (${unbound.id}) unbound`,
  );

  // Force the "last" skin into the unbound state. If a previous run (or any
  // other process) had bound it, release the ownership and drop any
  // drone_skins rows so the manual-bind flow has something to grab.
  const releasedPairs = await sql`
    DELETE FROM drone_skins WHERE skin_id = ${unbound.id} RETURNING drone_id
  `;
  if (releasedPairs.length > 0) {
    console.log(
      `  released ${releasedPairs.length} prior drone_skins row(s) for the unbound skin`,
    );
  }
  await sql`UPDATE skins SET user_id = NULL WHERE id = ${unbound.id}`;

  // Round-robin bindings across HELLO's drones. Track per-drone for the
  // report; multiple legendaries per drone is fine.
  const report = drones.map((d) => ({ ...d, bound: [] }));
  const reportByDroneId = Object.fromEntries(report.map((r) => [r.id, r]));
  let cursor = 0;
  let newBindings = 0;
  let keptBindings = 0;
  let skippedNonHello = 0;

  for (const skin of toBind) {
    // Is this skin already paired to ANY drone?
    const [existing] = await sql`
      SELECT ds.drone_id, d.user_id AS drone_owner
      FROM drone_skins ds
      JOIN drones d ON d.id = ds.drone_id
      WHERE ds.skin_id = ${skin.id}
      ORDER BY ds.created_at ASC
      LIMIT 1
    `;

    if (existing) {
      if (existing.drone_owner === hello.id) {
        // Already bound to a HELLO drone — keep the existing pair, just
        // re-home ownership in case it drifted.
        await sql`UPDATE skins SET user_id = ${hello.id} WHERE id = ${skin.id}`;
        const target = reportByDroneId[existing.drone_id];
        if (target) target.bound.push(skin.name);
        keptBindings += 1;
        continue;
      }
      // Bound to someone else's drone — leave it alone to avoid breaking
      // their state. This script never steals existing pairings.
      console.warn(
        `  skipping "${skin.name}" — already bound to a non-HELLO drone (${existing.drone_id})`,
      );
      skippedNonHello += 1;
      continue;
    }

    // Not yet bound. Pick the next drone via round-robin and bind, never
    // equipped. Re-home ownership to HELLO too.
    const drone = report[cursor % report.length];
    cursor += 1;

    await sql`UPDATE skins SET user_id = ${hello.id} WHERE id = ${skin.id}`;
    await sql`
      INSERT INTO drone_skins (drone_id, skin_id, is_equipped)
      VALUES (${drone.id}, ${skin.id}, false)
      ON CONFLICT (drone_id, skin_id) DO NOTHING
    `;
    drone.bound.push(skin.name);
    newBindings += 1;
  }

  console.log(
    `\nbindings: ${newBindings} new, ${keptBindings} already-on-HELLO (kept), ${skippedNonHello} on-non-HELLO (skipped)\n`,
  );
  console.log('per-drone legendary collection (all is_equipped = false):');
  for (const d of report) {
    if (d.bound.length === 0) {
      console.log(`  ${d.name} (Lv ${d.level}, ELO ${d.elo_rating}): —`);
    } else {
      console.log(
        `  ${d.name} (Lv ${d.level}, ELO ${d.elo_rating}): ${d.bound.join(', ')}`,
      );
    }
  }
  console.log(`\nleft unbound for manual-bind testing:`);
  console.log(`  ${unbound.name} (${unbound.id})  image=${unbound.image_url}`);

  // Sanity counts
  const [{ owned }] = await sql`
    SELECT COUNT(*)::int AS owned
    FROM skins
    WHERE rarity = 'legendary'
      AND user_id = ${hello.id}
      AND image_url LIKE '/skins/%'
      AND image_url LIKE '%.webp'
  `;
  const [{ vault }] = await sql`
    SELECT COUNT(*)::int AS vault
    FROM skins
    WHERE rarity = 'legendary'
      AND user_id IS NULL
      AND image_url LIKE '/skins/%'
      AND image_url LIKE '%.webp'
  `;
  console.log(
    `\nfinal: ${owned} legendaries owned by HELLO, ${vault} unbound in vault`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
