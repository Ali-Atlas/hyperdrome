/**
 * One-shot prod cleanup: dedupe legendary skin / mod ownership.
 *
 * Run:
 *   node --env-file=.env.local scripts/fix-legendary-duplicates.js
 *
 * For every user that owns more than one legendary skin with the same
 * name, keep the OLDEST row (createdAt asc) and delete the rest.
 * Same logic for legendary mods. Demo accounts included.
 *
 * FK behavior on cascade deletes:
 *   - drones.appliedSkinId  -> skins.id   ON DELETE SET NULL (auto)
 *   - drones.appliedModId   -> mods.id    ON DELETE SET NULL (auto)
 *   - drone_skins.skinId    -> skins.id   ON DELETE CASCADE  (auto)
 *   - drone_mods.modId      -> mods.id    ON DELETE CASCADE  (auto)
 *   - marketplace_listings.{skinId,modId} -> NO cascade (RESTRICT default)
 *
 * The MARKETPLACE FK is the one to mind: we won't delete a duplicate
 * that's still referenced by any marketplace_listings row (active OR
 * sold). For those we log a SKIP and leave the duplicate alone.
 *
 * Logs every removal and reports a final total.
 */

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import * as schema from '../lib/db/schema.js';

const RESOLVED_URL =
  process.env.PROD_DATABASE_URL ??
  (process.env.ALLOW_LOCAL_SEED === '1' ? process.env.DATABASE_URL : null);
if (!RESOLVED_URL) {
  console.error(
    'PROD_DATABASE_URL is not set. Add it to .env.local and re-run with `node --env-file=.env.local scripts/fix-legendary-duplicates.js`.',
  );
  process.exit(1);
}

const db = drizzle(neon(RESOLVED_URL), { schema });
const { users, skins, mods, marketplaceListings } = schema;

/**
 * Generic dedupe pass. `kind` is 'skin' or 'mod' - drives the table
 * + listing-FK column the function reads. Returns { removed, skipped,
 * groups }.
 */
async function dedupeLegendary(kind) {
  const table = kind === 'skin' ? skins : mods;
  const listingFk =
    kind === 'skin' ? marketplaceListings.skinId : marketplaceListings.modId;

  // 1. Find (userId, name) groups with >1 legendary row owned by a user.
  const groups = await db
    .select({
      userId: table.userId,
      name: table.name,
      count: sql`COUNT(*)::int`.as('count'),
    })
    .from(table)
    .where(
      and(
        eq(table.rarity, 'legendary'),
        sql`${table.userId} IS NOT NULL`,
      ),
    )
    .groupBy(table.userId, table.name)
    .having(sql`COUNT(*) > 1`);

  if (groups.length === 0) {
    console.log(`  No legendary ${kind} duplicates found.`);
    return { removed: 0, skipped: 0, groups: 0 };
  }

  console.log(`  ${groups.length} duplicate ${kind} group(s) detected.`);

  let removed = 0;
  let skipped = 0;

  for (const g of groups) {
    // 2. Pull every duplicate row in the group, oldest first.
    const dupes = await db
      .select()
      .from(table)
      .where(and(eq(table.userId, g.userId), eq(table.name, g.name)))
      .orderBy(asc(table.createdAt));

    if (dupes.length < 2) continue;

    // Resolve username for log readability (single-row lookup is cheap).
    const [u] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, g.userId))
      .limit(1);
    const ownerLabel = u?.username ?? g.userId;

    const keep = dupes[0];
    const candidates = dupes.slice(1);
    console.log(
      `  ${ownerLabel} / ${kind}=${g.name} : ${dupes.length} copies, keeping ${keep.id.slice(0, 8)} (created ${keep.createdAt.toISOString()})`,
    );

    for (const dupe of candidates) {
      // 3. Skip if any marketplace listing (active or sold) still
      //    references this row - deleting would violate the FK.
      const refs = await db
        .select({ id: marketplaceListings.id })
        .from(marketplaceListings)
        .where(eq(listingFk, dupe.id));
      if (refs.length > 0) {
        console.log(
          `    SKIP ${dupe.id.slice(0, 8)} - referenced by ${refs.length} marketplace_listings row(s)`,
        );
        skipped += 1;
        continue;
      }

      // 4. Delete. Cascade rules clear drones.appliedSkinId/ModId and
      //    drone_skins / drone_mods bindings automatically.
      await db.delete(table).where(eq(table.id, dupe.id));
      console.log(
        `    REMOVED ${dupe.id.slice(0, 8)} (created ${dupe.createdAt.toISOString()})`,
      );
      removed += 1;
    }
  }

  return { removed, skipped, groups: groups.length };
}

async function main() {
  console.log('\nDeduping legendary skins...');
  const skinResult = await dedupeLegendary('skin');

  console.log('\nDeduping legendary mods...');
  const modResult = await dedupeLegendary('mod');

  const totalRemoved = skinResult.removed + modResult.removed;
  const totalSkipped = skinResult.skipped + modResult.skipped;
  const totalGroups = skinResult.groups + modResult.groups;

  console.log('\n--- Summary ---');
  console.log(`  Skin groups: ${skinResult.groups}, removed: ${skinResult.removed}, skipped: ${skinResult.skipped}`);
  console.log(`  Mod groups : ${modResult.groups}, removed: ${modResult.removed}, skipped: ${modResult.skipped}`);
  console.log(`  TOTAL: ${totalGroups} duplicate group(s), ${totalRemoved} row(s) removed, ${totalSkipped} skipped (marketplace-referenced)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nDedupe failed:', err);
    process.exit(1);
  });
