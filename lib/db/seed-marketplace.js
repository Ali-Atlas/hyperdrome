// Seed the marketplace with sample drone + skin listings plus a handful of
// completed transactions so the /marketplace page has real data to render.
//
// Idempotent: re-running will detect existing seed-owned listings and skip.
//
// Invoke with: npm run seed:marketplace
//   (or: node --env-file=.env.local lib/db/seed-marketplace.js)

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import * as schema from './schema.js';

const { users, drones, skins, marketplaceListings } = schema;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const db = drizzle(neon(connectionString), { schema });

/* -------------------------------------------------------------------------- */
/* Seed participants                                                          */
/* -------------------------------------------------------------------------- */

const SELLERS = [
  { username: 'MKT_ORBIT',  email: 'mkt-orbit@seed.local' },
  { username: 'MKT_PULSE',  email: 'mkt-pulse@seed.local' },
  { username: 'MKT_NEXUS',  email: 'mkt-nexus@seed.local' },
];

const BUYERS = [
  { username: 'MKT_BUYER_ALPHA', email: 'mkt-buyer-alpha@seed.local' },
  { username: 'MKT_BUYER_BETA',  email: 'mkt-buyer-beta@seed.local' },
];

// 8 active drone listings, varied price tiers.
const DRONE_PRICES = [75, 180, 520, 900, 1_450, 2_400, 3_600, 5_000];

// Active skin listings grouped by rarity (price x count).
const SKIN_PLAN = [
  { rarity: 'common',    count: 4, prices: [40, 65, 90, 100] },
  { rarity: 'rare',      count: 4, prices: [220, 320, 420, 500] },
  { rarity: 'epic',      count: 2, prices: [1_200, 1_900] },
  { rarity: 'legendary', count: 2, prices: [3_500, 5_000] },
];

// 4 completed transactions (2 drones + 2 skins).
const SOLD_SPECS = [
  { itemType: 'drone', price: 1_250, daysAgo: 5 },
  { itemType: 'drone', price: 2_800, daysAgo: 2 },
  { itemType: 'skin',  rarity: 'rare',     price: 380, daysAgo: 6 },
  { itemType: 'skin',  rarity: 'epic',     price: 1_600, daysAgo: 1 },
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function ensureUser({ username, email }) {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(users)
    .values({ username, email, points: 10_000 })
    .returning();
  return created;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  console.log('Seeding marketplace...');

  // 1. Ensure seller + buyer user rows.
  const sellers = [];
  for (const s of SELLERS) sellers.push(await ensureUser(s));
  const buyers = [];
  for (const b of BUYERS) buyers.push(await ensureUser(b));
  const sellerIds = sellers.map((s) => s.id);
  console.log(`  sellers ensured (${sellers.length}) + buyers (${buyers.length})`);

  // 2. Idempotency check - skip if any listing from these sellers already
  //    exists (active OR sold). Lets the script stay safe to re-run.
  const [existing] = await db
    .select({ id: marketplaceListings.id })
    .from(marketplaceListings)
    .where(inArray(marketplaceListings.sellerId, sellerIds))
    .limit(1);
  if (existing) {
    console.log('  marketplace already seeded for these sellers, skipping.');
    return;
  }

  /* ---- 3. Active drone listings ------------------------------------------ */

  // Pick 8 bot drones to convert into seller inventory. Bot drones have
  // userId=null, so we re-home them to a fake seller (round-robin) and flip
  // isBot=false + active=false so they behave like dormant player drones.
  const botDrones = await db
    .select()
    .from(drones)
    .where(eq(drones.isBot, true))
    .limit(8);
  if (botDrones.length < 8) {
    console.warn(
      `  WARN only ${botDrones.length} bot drones available; expected 8.`,
    );
  }

  let created = 0;
  for (let i = 0; i < botDrones.length; i++) {
    const drone = botDrones[i];
    const seller = sellers[i % sellers.length];
    const price = DRONE_PRICES[i];

    await db
      .update(drones)
      .set({ userId: seller.id, isBot: false, active: false })
      .where(eq(drones.id, drone.id));

    await db.insert(marketplaceListings).values({
      sellerId: seller.id,
      itemType: 'drone',
      droneId: drone.id,
      price,
      status: 'active',
    });
    created += 1;
  }
  console.log(`  drone listings inserted (${created})`);

  /* ---- 4. Active skin listings ------------------------------------------- */

  let skinCount = 0;
  for (const plan of SKIN_PLAN) {
    const available = await db
      .select()
      .from(skins)
      .where(and(eq(skins.rarity, plan.rarity), isNull(skins.userId)))
      .limit(plan.count);

    if (available.length < plan.count) {
      console.warn(
        `  WARN only ${available.length} unowned ${plan.rarity} skins; expected ${plan.count}.`,
      );
    }

    for (let i = 0; i < available.length; i++) {
      const skin = available[i];
      const seller = sellers[i % sellers.length];
      const price = plan.prices[i];

      await db
        .update(skins)
        .set({ userId: seller.id })
        .where(eq(skins.id, skin.id));

      await db.insert(marketplaceListings).values({
        sellerId: seller.id,
        itemType: 'skin',
        skinId: skin.id,
        price,
        status: 'active',
      });
      skinCount += 1;
    }
  }
  console.log(`  skin listings inserted (${skinCount})`);

  /* ---- 5. Completed sales ------------------------------------------------ */

  // Drones for sold transactions: 2 more bots, same conversion treatment but
  // they immediately land in a buyer's hands.
  const soldDrones = await db
    .select()
    .from(drones)
    .where(eq(drones.isBot, true))
    .limit(2);

  let soldCount = 0;
  let droneIdx = 0;
  for (let i = 0; i < SOLD_SPECS.length; i++) {
    const spec = SOLD_SPECS[i];
    const seller = sellers[i % sellers.length];
    const buyer = buyers[i % buyers.length];
    const platformFee = Math.floor(spec.price * 0.05);
    const soldAt = new Date(Date.now() - spec.daysAgo * 24 * 60 * 60 * 1000);
    const payload = {
      sellerId: seller.id,
      itemType: spec.itemType,
      price: spec.price,
      status: 'sold',
      buyerId: buyer.id,
      soldAt,
      platformFee,
    };

    if (spec.itemType === 'drone') {
      const drone = soldDrones[droneIdx++];
      if (!drone) continue;
      await db
        .update(drones)
        .set({ userId: buyer.id, isBot: false, active: false })
        .where(eq(drones.id, drone.id));
      payload.droneId = drone.id;
    } else {
      const [skin] = await db
        .select()
        .from(skins)
        .where(and(eq(skins.rarity, spec.rarity), isNull(skins.userId)))
        .limit(1);
      if (!skin) continue;
      await db
        .update(skins)
        .set({ userId: buyer.id })
        .where(eq(skins.id, skin.id));
      payload.skinId = skin.id;
    }

    await db.insert(marketplaceListings).values(payload);
    soldCount += 1;
  }
  console.log(`  sold transactions inserted (${soldCount})`);

  console.log('Marketplace seed complete.');
}

main().catch((err) => {
  console.error('Marketplace seed failed:', err);
  process.exit(1);
});
