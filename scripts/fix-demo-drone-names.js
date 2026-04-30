#!/usr/bin/env node
/**
 * One-shot fix for demo accounts that were seeded BEFORE seed-demo-player.js
 * switched to `generateUniqueDroneName`. Those legacy seeds gave every demo
 * account the same hardcoded roster (STRIKER / RUNNER / VIPER / ...), so the
 * prod drones table now has many duplicate names across PILOT_D* users.
 *
 * Behavior:
 *   1. Find every drone name that appears more than once across the WHOLE
 *      drones table.
 *   2. For each PILOT_D*-owned drone with one of those names, generate a
 *      unique replacement via `generateUniqueDroneName` and update in place.
 *   3. Log every rename in the form "STRIKER (PILOT_D01) → VORTEX-X3".
 *
 * Non-PILOT_D drones are never touched, even when they share a name with a
 * PILOT_D drone — the assumption is the organic name is the one to keep.
 *
 * Connects to PROD_DATABASE_URL (or DATABASE_URL when ALLOW_LOCAL_SEED=1
 * is set, mirroring the seed-production fail-closed pattern).
 *
 * Usage:
 *   node --env-file=.env.local scripts/fix-demo-drone-names.js
 */

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { and, eq, inArray, like, sql } from 'drizzle-orm';

import * as schema from '../lib/db/schema.js';
import { generateUniqueDroneName } from '../lib/game-engine/drone-names.js';

const { users, drones } = schema;

const RESOLVED_URL =
  process.env.PROD_DATABASE_URL ??
  (process.env.ALLOW_LOCAL_SEED === '1' ? process.env.DATABASE_URL : null);
if (!RESOLVED_URL) {
  console.error(
    'PROD_DATABASE_URL is not set. Add it to .env.local and re-run with `node --env-file=.env.local scripts/fix-demo-drone-names.js` (or set ALLOW_LOCAL_SEED=1 to target the dev DB).',
  );
  process.exit(1);
}

const db = drizzle(neon(RESOLVED_URL), { schema });

async function main() {
  console.log('\nfix-demo-drone-names: scanning prod drones table...\n');

  // 1. Names with count > 1 across the whole drones table.
  const dupeRows = await db
    .select({ name: drones.name, count: sql`count(*)::int`.as('count') })
    .from(drones)
    .groupBy(drones.name)
    .having(sql`count(*) > 1`);

  if (dupeRows.length === 0) {
    console.log('No duplicate drone names found. Nothing to do.\n');
    return;
  }
  const dupeNames = dupeRows.map((r) => r.name);
  console.log(
    `${dupeRows.length} duplicated name(s) found: ${dupeNames.join(', ')}\n`,
  );

  // 2. PILOT_D*-owned drones whose name is one of the duplicates.
  const targets = await db
    .select({
      droneId: drones.id,
      droneName: drones.name,
      userName: users.name,
    })
    .from(drones)
    .innerJoin(users, eq(users.id, drones.userId))
    .where(
      and(inArray(drones.name, dupeNames), like(users.name, 'PILOT_D%')),
    );

  if (targets.length === 0) {
    console.log(
      'No PILOT_D*-owned drones share those names. Nothing to rename.\n',
    );
    return;
  }
  console.log(
    `${targets.length} PILOT_D drone(s) to rename. Renaming sequentially so generateUniqueDroneName sees prior commits...\n`,
  );

  // 3. Rename each. Sequential (not Promise.all) so each generator call
  // sees the previously-committed names and the uniqueness check holds.
  let renamed = 0;
  for (const t of targets) {
    const newName = await generateUniqueDroneName(db, drones);
    await db
      .update(drones)
      .set({ name: newName })
      .where(eq(drones.id, t.droneId));
    console.log(`${t.droneName} (${t.userName}) → ${newName}`);
    renamed += 1;
  }

  console.log(
    `\nDone. Renamed ${renamed} drone(s) across PILOT_D* demo accounts.\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nfix-demo-drone-names failed:\n', err);
    process.exit(1);
  });
