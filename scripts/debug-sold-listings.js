/**
 * One-shot debug: print what `/api/marketplace?status=sold&limit=10`
 * actually returns. Mirrors `getListings({ status: 'sold' })` from
 * services/marketplace.service.js using relative imports so it runs
 * under plain node (the service uses the `@/` alias which only the
 * Next bundler resolves).
 *
 * Run:
 *   node --env-file=.env.local scripts/debug-sold-listings.js
 */

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { and, desc, eq, inArray } from 'drizzle-orm';

import * as schema from '../lib/db/schema.js';

const RESOLVED_URL =
  process.env.PROD_DATABASE_URL ??
  (process.env.ALLOW_LOCAL_SEED === '1' ? process.env.DATABASE_URL : null);
if (!RESOLVED_URL) {
  console.error('PROD_DATABASE_URL not set in .env.local');
  process.exit(1);
}
const db = drizzle(neon(RESOLVED_URL), { schema });

const {
  marketplaceListings,
  drones,
  skins,
  mods,
  users,
} = schema;

async function main() {
  const limit = 10;
  const rows = await db
    .select()
    .from(marketplaceListings)
    .where(eq(marketplaceListings.status, 'sold'))
    .orderBy(desc(marketplaceListings.soldAt))
    .limit(limit);

  console.log(`\nFetched ${rows.length} sold listings (raw rows).\n`);

  const droneIds = rows.map((r) => r.droneId).filter(Boolean);
  const skinIds = rows.map((r) => r.skinId).filter(Boolean);
  const modIds = rows.map((r) => r.modId).filter(Boolean);
  const userIds = [
    ...new Set([
      ...rows.map((r) => r.sellerId),
      ...rows.map((r) => r.buyerId).filter(Boolean),
    ]),
  ];

  const [droneRows, skinRows, modRows, userRows] = await Promise.all([
    droneIds.length
      ? db
          .select({ drone: drones, appliedSkin: skins })
          .from(drones)
          .leftJoin(skins, eq(drones.appliedSkinId, skins.id))
          .where(inArray(drones.id, droneIds))
      : Promise.resolve([]),
    skinIds.length
      ? db.select().from(skins).where(inArray(skins.id, skinIds))
      : Promise.resolve([]),
    modIds.length
      ? db.select().from(mods).where(inArray(mods.id, modIds))
      : Promise.resolve([]),
    userIds.length
      ? db
          .select({ id: users.id, username: users.username })
          .from(users)
          .where(inArray(users.id, userIds))
      : Promise.resolve([]),
  ]);

  console.log('--- Raw join results ---');
  console.log('  droneRows count:', droneRows.length);
  console.log('  skinRows count :', skinRows.length);
  console.log('  modRows count  :', modRows.length);
  console.log('  userRows count :', userRows.length);
  if (droneRows.length > 0) {
    const sample = droneRows[0];
    console.log('  droneRows[0] keys:', Object.keys(sample));
    console.log(
      '  droneRows[0].appliedSkin:',
      sample.appliedSkin === null
        ? 'NULL'
        : sample.appliedSkin === undefined
          ? 'UNDEFINED'
          : `OBJECT (rarity=${sample.appliedSkin.rarity ?? 'null'})`,
    );
  }
  console.log();

  const droneMap = Object.fromEntries(
    droneRows.map(({ drone, appliedSkin }) => [
      drone.id,
      { ...drone, appliedSkin },
    ]),
  );
  const skinMap = Object.fromEntries(skinRows.map((s) => [s.id, s]));
  const modMap = Object.fromEntries(modRows.map((m) => [m.id, m]));
  const userMap = Object.fromEntries(userRows.map((u) => [u.id, u]));

  const enriched = rows.map((r) => ({
    ...r,
    drone: r.droneId ? droneMap[r.droneId] : null,
    skin: r.skinId ? skinMap[r.skinId] : null,
    mod: r.modId ? modMap[r.modId] : null,
    seller: userMap[r.sellerId] ?? null,
    buyer: r.buyerId ? userMap[r.buyerId] ?? null : null,
  }));

  console.log('--- Enriched listings ---');
  enriched.forEach((t, i) => {
    const skinR = t.skin?.rarity ?? null;
    const modR = t.mod?.rarity ?? null;
    const droneAS = t.drone?.appliedSkin;
    const droneASR = droneAS?.rarity ?? null;
    const droneASShape = !t.drone
      ? 'no drone'
      : droneAS === null
        ? 'NULL'
        : droneAS === undefined
          ? 'UNDEFINED'
          : 'OBJECT';
    console.log(
      `#${i + 1} id=${t.id.slice(0, 8)} type=${t.itemType.padEnd(5)} ` +
        `soldAt=${t.soldAt?.toISOString?.() ?? t.soldAt}`,
    );
    console.log(
      `   skin=${t.skin ? 'present' : 'null'} rarity=${skinR}`,
    );
    console.log(
      `   mod=${t.mod ? 'present' : 'null'} rarity=${modR}`,
    );
    console.log(
      `   drone=${t.drone ? 'present' : 'null'} ` +
        `lvl=${t.drone?.level ?? 'n/a'} ` +
        `appliedSkinId=${t.drone?.appliedSkinId ?? 'null'} ` +
        `appliedSkin=${droneASShape} ` +
        `rarity=${droneASR}`,
    );
    console.log(
      `   seller=${t.seller?.username ?? 'null'} ` +
        `buyer=${t.buyer?.username ?? 'null'} ` +
        `price=${t.price}`,
    );
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nDebug failed:', err);
    process.exit(1);
  });
