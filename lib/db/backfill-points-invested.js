// One-off backfill: set drones.total_points_invested for every existing
// drone based on its current 9 stat values (cost to take each stat from 1
// up to its present level, summed). Idempotent - re-running computes the
// same value for any given stat snapshot.
// Invoke with: node --env-file=.env.local lib/db/backfill-points-invested.js
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq } from 'drizzle-orm';
import * as schema from './schema.js';
import {
  STAT_KEYS,
  calculateTotalUpgradeCost,
} from '../game-engine/economy.js';

const { drones } = schema;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const db = drizzle(neon(connectionString), { schema });

async function main() {
  const allDrones = await db.select().from(drones);
  console.log(`Backfilling total_points_invested for ${allDrones.length} drones...`);

  let updated = 0;
  for (const d of allDrones) {
    let invested = 0;
    for (const key of STAT_KEYS) {
      const current = d[key] ?? 1;
      invested += calculateTotalUpgradeCost(1, current);
    }
    await db
      .update(drones)
      .set({ totalPointsInvested: invested })
      .where(eq(drones.id, d.id));
    updated += 1;
  }

  console.log(`Done. Updated ${updated} drones.`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
