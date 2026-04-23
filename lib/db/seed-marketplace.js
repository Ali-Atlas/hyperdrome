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

// Fresh marketplace drones covering tiers 2/3/4 - the bot pool tops out
// at level 10, so higher-tier inventory has to be created directly.
// Keyed by name so re-runs are per-drone idempotent (see main()).
// Total target: 50 marketplace drone listings across the 4 tiers
// (8 bot-rehomed tier-1/2 + 42 fresh entries here = 50).
const MKT_DRONES = [
  // tier-1 (L1-5) - 10 drones. Fills out the low-price shelf.
  { name: 'MKT_SCOUT_01',   level: 1,  speed: 4,  turning: 4,  durability: 4,  acceleration: 5,  price: 90    },
  { name: 'MKT_SCOUT_02',   level: 2,  speed: 7,  turning: 6,  durability: 5,  acceleration: 6,  price: 140   },
  { name: 'MKT_SCOUT_03',   level: 2,  speed: 6,  turning: 7,  durability: 6,  acceleration: 7,  price: 160   },
  { name: 'MKT_SCOUT_04',   level: 3,  speed: 10, turning: 8,  durability: 7,  acceleration: 9,  price: 220   },
  { name: 'MKT_SCOUT_05',   level: 3,  speed: 11, turning: 9,  durability: 8,  acceleration: 9,  price: 260   },
  { name: 'MKT_SCOUT_06',   level: 4,  speed: 13, turning: 11, durability: 9,  acceleration: 11, price: 330   },
  { name: 'MKT_SCOUT_07',   level: 4,  speed: 14, turning: 10, durability: 10, acceleration: 12, price: 380   },
  { name: 'MKT_SCOUT_08',   level: 5,  speed: 17, turning: 13, durability: 11, acceleration: 14, price: 470   },
  { name: 'MKT_SCOUT_09',   level: 5,  speed: 18, turning: 14, durability: 12, acceleration: 15, price: 520   },
  { name: 'MKT_SCOUT_10',   level: 5,  speed: 16, turning: 15, durability: 13, acceleration: 14, price: 560   },

  // tier-2 (L6-10) - 10 drones. The mid-range sweet spot.
  { name: 'MKT_SKIMMER_01', level: 6,  speed: 21, turning: 16, durability: 14, acceleration: 18, price: 700   },
  { name: 'MKT_SKIMMER_02', level: 7,  speed: 25, turning: 19, durability: 17, acceleration: 21, price: 880   },
  { name: 'MKT_SKIMMER_03', level: 8,  speed: 30, turning: 22, durability: 20, acceleration: 26, price: 1_100 },
  { name: 'MKT_SKIMMER_04', level: 10, speed: 38, turning: 28, durability: 26, acceleration: 32, price: 1_900 },
  { name: 'MKT_SKIMMER_05', level: 7,  speed: 24, turning: 20, durability: 18, acceleration: 22, price: 950   },
  { name: 'MKT_SKIMMER_06', level: 8,  speed: 28, turning: 24, durability: 21, acceleration: 25, price: 1_250 },
  { name: 'MKT_SKIMMER_07', level: 9,  speed: 33, turning: 25, durability: 23, acceleration: 29, price: 1_500 },
  { name: 'MKT_SKIMMER_08', level: 9,  speed: 34, turning: 27, durability: 24, acceleration: 30, price: 1_650 },
  { name: 'MKT_SKIMMER_09', level: 10, speed: 40, turning: 30, durability: 27, acceleration: 34, price: 2_100 },
  { name: 'MKT_SKIMMER_10', level: 10, speed: 37, turning: 31, durability: 28, acceleration: 33, price: 2_250 },

  // tier-3 (L11-15) - 12 drones.
  { name: 'MKT_ASCENT_01',  level: 12, speed: 44, turning: 32, durability: 30, acceleration: 40, price: 2_800 },
  { name: 'MKT_ASCENT_02',  level: 15, speed: 58, turning: 42, durability: 40, acceleration: 52, price: 5_200 },
  { name: 'MKT_ASCENT_03',  level: 11, speed: 41, turning: 30, durability: 28, acceleration: 36, price: 2_500 },
  { name: 'MKT_ASCENT_04',  level: 11, speed: 42, turning: 32, durability: 29, acceleration: 37, price: 2_650 },
  { name: 'MKT_ASCENT_05',  level: 12, speed: 46, turning: 34, durability: 32, acceleration: 41, price: 3_000 },
  { name: 'MKT_ASCENT_06',  level: 13, speed: 49, turning: 36, durability: 34, acceleration: 44, price: 3_500 },
  { name: 'MKT_ASCENT_07',  level: 13, speed: 50, turning: 38, durability: 35, acceleration: 46, price: 3_800 },
  { name: 'MKT_ASCENT_08',  level: 14, speed: 53, turning: 40, durability: 37, acceleration: 48, price: 4_200 },
  { name: 'MKT_ASCENT_09',  level: 14, speed: 55, turning: 41, durability: 38, acceleration: 50, price: 4_600 },
  { name: 'MKT_ASCENT_10',  level: 15, speed: 60, turning: 44, durability: 41, acceleration: 54, price: 5_600 },
  { name: 'MKT_ASCENT_11',  level: 15, speed: 62, turning: 46, durability: 42, acceleration: 56, price: 6_000 },
  { name: 'MKT_ASCENT_12',  level: 15, speed: 57, turning: 48, durability: 44, acceleration: 55, price: 6_400 },

  // tier-4 (L16-20) - 10 drones. The apex price shelf.
  { name: 'MKT_APEX_01',    level: 18, speed: 72, turning: 54, durability: 52, acceleration: 66, price: 9_000  },
  { name: 'MKT_APEX_02',    level: 20, speed: 86, turning: 66, durability: 64, acceleration: 80, price: 14_500 },
  { name: 'MKT_APEX_03',    level: 16, speed: 64, turning: 48, durability: 46, acceleration: 60, price: 7_000  },
  { name: 'MKT_APEX_04',    level: 16, speed: 66, turning: 50, durability: 47, acceleration: 62, price: 7_400  },
  { name: 'MKT_APEX_05',    level: 17, speed: 68, turning: 52, durability: 49, acceleration: 64, price: 8_000  },
  { name: 'MKT_APEX_06',    level: 17, speed: 70, turning: 53, durability: 51, acceleration: 65, price: 8_500  },
  { name: 'MKT_APEX_07',    level: 18, speed: 74, turning: 55, durability: 53, acceleration: 68, price: 9_600  },
  { name: 'MKT_APEX_08',    level: 19, speed: 78, turning: 58, durability: 56, acceleration: 72, price: 11_200 },
  { name: 'MKT_APEX_09',    level: 19, speed: 80, turning: 60, durability: 58, acceleration: 74, price: 12_000 },
  { name: 'MKT_APEX_10',    level: 20, speed: 88, turning: 68, durability: 66, acceleration: 82, price: 16_500 },
];

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

  // 2a. Top-up: create tier-2/3/4 drones that the bot pool can't supply.
  //     Per-drone idempotent (checked by unique MKT_ name), so this runs
  //     even if step 2b below decides the rest is already seeded.
  let mktCreated = 0;
  for (let i = 0; i < MKT_DRONES.length; i++) {
    const spec = MKT_DRONES[i];
    const [already] = await db
      .select({ id: drones.id })
      .from(drones)
      .where(eq(drones.name, spec.name))
      .limit(1);
    if (already) continue;

    const seller = sellers[i % sellers.length];
    const [created] = await db
      .insert(drones)
      .values({
        userId: seller.id,
        name: spec.name,
        level: spec.level,
        speed: spec.speed,
        turning: spec.turning,
        durability: spec.durability,
        acceleration: spec.acceleration,
        isBot: false,
        active: false,
      })
      .returning({ id: drones.id });

    await db.insert(marketplaceListings).values({
      sellerId: seller.id,
      itemType: 'drone',
      droneId: created.id,
      price: spec.price,
      status: 'active',
    });
    mktCreated += 1;
  }
  if (mktCreated > 0) {
    console.log(`  tier-2/3/4 marketplace drones created (${mktCreated})`);
  }

  // 2b. Idempotency check - skip the rest if any bot-rehome or skin/sold
  //     listing from these sellers already exists. Keeps re-runs safe.
  const [existing] = await db
    .select({ id: marketplaceListings.id })
    .from(marketplaceListings)
    .where(
      and(
        inArray(marketplaceListings.sellerId, sellerIds),
        eq(marketplaceListings.itemType, 'skin'),
      ),
    )
    .limit(1);
  if (existing) {
    console.log('  skin + bot-rehome section already seeded, skipping.');
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
