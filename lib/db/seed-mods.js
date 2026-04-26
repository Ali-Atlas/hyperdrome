// Seed the mods catalog + marketplace listings + per-drone collections.
//
// Idempotent: re-running detects existing rows and skips. Run this AFTER
// the main seed (so users + drones exist) and AFTER seed-marketplace (so
// the MKT_* seller users exist).
//
// Invoke with:
//   node --env-file=.env.local lib/db/seed-mods.js

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import * as schema from './schema.js';

const { users, drones, mods, droneMods, marketplaceListings } = schema;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const db = drizzle(neon(connectionString), { schema });

/* -------------------------------------------------------------------------- */
/* Catalog                                                                    */
/* -------------------------------------------------------------------------- */

/** 26 mod templates across rarities. Stat keys are camelCase to match the
 *  drone schema columns. The race engine integration is deferred; for now
 *  these values are display-only on the marketplace + drone screens. */
const MOD_TEMPLATES = [
  // ---- Common (10) ----
  { name: 'Streamline Plate', rarity: 'common', bonus: ['speed', 2],          penalty: ['turning', 1] },
  { name: 'Grip Pads',        rarity: 'common', bonus: ['turning', 2],        penalty: ['speed', 1] },
  { name: 'Quick Charge',     rarity: 'common', bonus: ['batteryCapacity', 2], penalty: ['durability', 1] },
  { name: 'Shock Absorber',   rarity: 'common', bonus: ['durability', 2],     penalty: ['acceleration', 1] },
  { name: 'Steady Module',    rarity: 'common', bonus: ['consistency', 2],    penalty: ['speed', 1] },
  { name: 'Night Lens',       rarity: 'common', bonus: ['nightVision', 2],    penalty: ['rainHandling', 1] },
  { name: 'Rain Shield',      rarity: 'common', bonus: ['rainHandling', 2],   penalty: ['windResistance', 1] },
  { name: 'Wind Fin',         rarity: 'common', bonus: ['windResistance', 2], penalty: ['nightVision', 1] },
  { name: 'Light Frame',      rarity: 'common', bonus: ['acceleration', 2],   penalty: ['durability', 1] },
  { name: 'Tracker Coil',     rarity: 'common', bonus: ['turning', 2],        penalty: ['batteryCapacity', 1] },

  // ---- Rare (8) - all +4 bonus / -2 penalty (net +2) ----
  { name: 'Aero Shell',       rarity: 'rare', bonus: ['speed', 4],            penalty: ['turning', 2] },
  { name: 'Grip Coating',     rarity: 'rare', bonus: ['turning', 4],          penalty: ['acceleration', 2] },
  { name: 'Storm Plating',    rarity: 'rare', bonus: ['rainHandling', 4],     penalty: ['speed', 2] },
  { name: 'Night Optics',     rarity: 'rare', bonus: ['nightVision', 4],      penalty: ['batteryCapacity', 2] },
  { name: 'Turbo Intake',     rarity: 'rare', bonus: ['acceleration', 4],     penalty: ['consistency', 2] },
  { name: 'Endurance Core',   rarity: 'rare', bonus: ['batteryCapacity', 4],  penalty: ['speed', 2] },
  { name: 'Aileron Kit',      rarity: 'rare', bonus: ['windResistance', 4],   penalty: ['acceleration', 2] },
  { name: 'Stabilizer Brace', rarity: 'rare', bonus: ['consistency', 4],      penalty: ['speed', 2] },

  // ---- Epic (5) ----
  { name: 'Plasma Core',      rarity: 'epic', bonus: ['acceleration', 6],     penalty: ['consistency', 4] },
  { name: 'Stealth Aero',     rarity: 'epic', bonus: ['speed', 6],            penalty: ['durability', 4] },
  { name: 'Typhoon Module',   rarity: 'epic', bonus: ['rainHandling', 8],     penalty: ['speed', 5] },
  { name: 'Predator Lens',    rarity: 'epic', bonus: ['nightVision', 8],      penalty: ['batteryCapacity', 5] },
  { name: 'Iron Hull',        rarity: 'epic', bonus: ['durability', 7],       penalty: ['turning', 4] },

  // ---- Legendary (3) ----
  {
    name: 'Phantom Drive',
    rarity: 'legendary',
    special: 'Ignores battery degradation on lap 1.',
    penalty: ['windResistance', 5],
  },
  {
    name: 'Quantum Sync',
    rarity: 'legendary',
    special: 'Consistency stat applies double on turn segments.',
    penalty: ['speed', 4],
  },
  {
    name: 'Storm Rider',
    rarity: 'legendary',
    special: 'All weather penalties reduced by 50%.',
    penalty: ['acceleration', 6],
  },
];

/** Build the descriptive text shown on cards / drone selectors. */
function buildDescription(t) {
  if (t.rarity === 'legendary') {
    return `${t.special} ${penaltyText(t.penalty)}.`;
  }
  return `${bonusText(t.bonus)}, ${penaltyText(t.penalty)}.`;
}

function bonusText([key, val]) {
  return `+${val}% ${prettyStat(key)}`;
}

function penaltyText([key, val]) {
  return `-${val}% ${prettyStat(key)}`;
}

const STAT_LABEL = {
  speed: 'Speed',
  turning: 'Turning',
  acceleration: 'Acceleration',
  durability: 'Durability',
  consistency: 'Consistency',
  batteryCapacity: 'Battery',
  nightVision: 'Night Vision',
  rainHandling: 'Rain',
  windResistance: 'Wind',
};

function prettyStat(key) {
  return STAT_LABEL[key] ?? key;
}

/** Materialize a template into a `mods` insert row (no userId yet). */
function templateToRow(t) {
  return {
    name: t.name,
    rarity: t.rarity,
    description: buildDescription(t),
    statBonusType: t.bonus ? t.bonus[0] : null,
    statBonusValue: t.bonus ? String(t.bonus[1]) : null,
    statPenaltyType: t.penalty ? t.penalty[0] : null,
    statPenaltyValue: t.penalty ? String(t.penalty[1]) : null,
    specialAbility: t.special ?? null,
    imageUrl: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Marketplace allocations                                                    */
/* -------------------------------------------------------------------------- */

// 30 mod listings spread across rarities + sellers.
const LISTING_PLAN = [
  { rarity: 'common',    count: 12, prices: [60, 80, 95, 110, 130, 150, 170, 190, 210, 230, 250, 270] },
  { rarity: 'rare',      count: 10, prices: [400, 480, 560, 640, 720, 800, 900, 1_000, 1_150, 1_300] },
  { rarity: 'epic',      count: 6,  prices: [2_200, 2_700, 3_200, 3_800, 4_500, 5_400] },
  { rarity: 'legendary', count: 2,  prices: [9_500, 14_000] },
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const SELLER_EMAILS = [
  'mkt-orbit@seed.local',
  'mkt-pulse@seed.local',
  'mkt-nexus@seed.local',
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  console.log('Seeding mods...');

  /* ---- 1. Catalog: 26 unowned mod templates ----------------------------- */
  const existingNames = new Set(
    (await db.select({ name: mods.name }).from(mods)).map((r) => r.name),
  );

  const newRows = MOD_TEMPLATES
    .filter((t) => !existingNames.has(t.name))
    .map(templateToRow);

  if (newRows.length > 0) {
    await db.insert(mods).values(newRows);
    console.log(`  catalog seeded (${newRows.length} templates)`);
  } else {
    console.log('  catalog already present');
  }

  /* ---- 2. Marketplace: 30 mod listings from MKT_* sellers --------------- */

  const sellerRows = await db
    .select()
    .from(users)
    .where(inArray(users.email, SELLER_EMAILS));
  if (sellerRows.length === 0) {
    console.warn('  WARN no MKT_* sellers found; run seed-marketplace first.');
  }

  // Idempotency: skip if any mod listing from these sellers already exists.
  const sellerIds = sellerRows.map((s) => s.id);
  const [existingListing] = sellerIds.length
    ? await db
        .select({ id: marketplaceListings.id })
        .from(marketplaceListings)
        .where(
          and(
            inArray(marketplaceListings.sellerId, sellerIds),
            eq(marketplaceListings.itemType, 'mod'),
          ),
        )
        .limit(1)
    : [null];

  if (existingListing) {
    console.log('  mod listings already seeded, skipping marketplace step.');
  } else if (sellerRows.length > 0) {
    let listingIdx = 0;
    let listingCount = 0;
    for (const plan of LISTING_PLAN) {
      const templates = MOD_TEMPLATES.filter((t) => t.rarity === plan.rarity);
      if (templates.length === 0) continue;

      for (let i = 0; i < plan.count; i++) {
        const template = templates[i % templates.length];
        const seller = sellerRows[listingIdx % sellerRows.length];
        const price = plan.prices[i];

        // Insert a fresh mod instance owned by the seller (unbound).
        const [created] = await db
          .insert(mods)
          .values({ ...templateToRow(template), userId: seller.id })
          .returning({ id: mods.id });

        await db.insert(marketplaceListings).values({
          sellerId: seller.id,
          itemType: 'mod',
          modId: created.id,
          price,
          status: 'active',
        });

        listingIdx += 1;
        listingCount += 1;
      }
    }
    console.log(`  mod listings inserted (${listingCount})`);
  }

  /* ---- 3. Per-user drone mod collections -------------------------------- */
  // Bind 2-5 random mods to each non-bot drone owned by a real player; set
  // one equipped. Idempotent: skip drones that already have any drone_mods.

  const playerDrones = await db
    .select()
    .from(drones)
    .where(and(eq(drones.isBot, false), isNotNull(drones.userId)));

  let bindCount = 0;
  let droneCount = 0;
  for (const drone of playerDrones) {
    if (!drone.userId) continue;

    // Skip the drone if it already has bindings.
    const existingBindings = await db
      .select({ id: droneMods.id })
      .from(droneMods)
      .where(eq(droneMods.droneId, drone.id))
      .limit(1);
    if (existingBindings.length > 0) continue;

    const target = 2 + Math.floor(Math.random() * 4); // 2-5
    const picked = shuffle(MOD_TEMPLATES).slice(0, target);

    for (let i = 0; i < picked.length; i++) {
      const template = picked[i];
      // Each binding gets its own fresh mod instance owned by the player.
      const [created] = await db
        .insert(mods)
        .values({ ...templateToRow(template), userId: drone.userId })
        .returning({ id: mods.id });

      const isEquipped = i === 0;
      await db.insert(droneMods).values({
        droneId: drone.id,
        modId: created.id,
        isEquipped,
      });

      if (isEquipped) {
        await db
          .update(drones)
          .set({ appliedModId: created.id })
          .where(eq(drones.id, drone.id));
      }
      bindCount += 1;
    }
    droneCount += 1;
  }
  if (droneCount > 0) {
    console.log(
      `  drone mod collections seeded (${bindCount} bindings across ${droneCount} drones)`,
    );
  } else {
    console.log('  drone mod collections already seeded');
  }

  console.log('Mods seed complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
