import { and, eq, inArray, isNull, like, notInArray, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { ApiError } from '@/lib/api/response.js';

const { users, skins, mods } = schema;

/* -------------------------------------------------------------------------- */
/* On-demand mint catalogs                                                    */
/*                                                                            */
/* When the vault is empty for a given rarity, the pack open falls back to   */
/* mintSkin / mintMod which create a *new* row using a procedurally-picked   */
/* name from the placeholder pools below. Image-backed catalog skins         */
/* (/skins/<rarity>/*.webp) are NEVER duplicated by the mint path -          */
/* minted skins always use a /placeholder/ URL so they render as the         */
/* rarity-tinted swatch (handled by marketplace + drone-equip fallback).     */
/*                                                                            */
/* Skin name pools are mirrored from scripts/seed-production.js's            */
/* PLACEHOLDER_NAME_POOLS so minted rows are visually indistinguishable      */
/* from seeded placeholder vault rows. Mod stat shapes come from MOD_TEMPLATES */
/* (carefully balanced); only the mod *name* is freshly generated.           */
/* -------------------------------------------------------------------------- */

const SKIN_NAME_POOLS = {
  common: [
    'Carbon Fiber', 'Gunmetal', 'Stealth Gray', 'Arctic White', 'Obsidian',
    'Matte Black', 'Brushed Steel', 'Copper Plate', 'Navy Blue', 'Forest Green',
    'Desert Tan', 'Slate Gray', 'Rust Patina', 'Industrial Iron', 'Concrete',
    'Military Olive', 'Plasma Gray', 'Alloy Silver', 'Chrome Plate', 'Warning Yellow',
    'Flare Orange', 'Ember Red', 'Cool Blue', 'Stormcloud', 'Midnight Black',
    'Ash Gray', 'Riveted Steel', 'Bronze Plating', 'Aluminum Finish', 'Coal Matte',
  ],
  rare: [
    'Neon Pulse', 'Cyber Stripe', 'Electric Blue', 'Hologram', 'Signal Red',
    'Grid Runner', 'Data Stream', 'Binary Wave', 'Tron Line', 'Synthwave',
    'Laser Mesh', 'Circuit Board', 'Prism', 'Quantum Weave', 'Plasma Core',
    'Phantom Edge', 'Iron Veil', 'Cobalt Strike', 'Static Drift', 'Mirror Coil',
    'Spectral Mesh', 'Voltage Husk', 'Ion Lattice', 'Nova Burst',
  ],
  epic: [
    'Inferno Phoenix', 'Tidal Surge', 'Thunder Strike', 'Void Walker',
    'Blizzard Hunter', 'Volcanic Drift', 'Celestial Guard', 'Zephyr Dancer',
    'Eclipse Prowler', 'Ember Coil', 'Glacial Tempest', 'Stormcaller',
    'Riftwalker', 'Aurora Reaver',
  ],
  legendary: [
    'Chimera', 'Phoenix Reborn', 'Dragonlord', 'Onyx Sovereign',
  ],
};

/* Mod name pools for the mint path. Stats come from MOD_TEMPLATES (so balance
 * is preserved); only the surface name is fresh, so a minted mod is clearly
 * not a duplicate of one of the curated catalog pieces. */
const MOD_NAME_POOLS = {
  common: [
    'Standard Plate', 'Basic Coil', 'Stock Brace', 'Field Kit', 'Utility Pack',
    'Workshop Brace', 'Stock Mount', 'Generic Coil', 'Spare Plate', 'Surplus Module',
  ],
  rare: [
    'Tuned Module', 'Refined Coil', 'Calibrated Plate', 'Polished Brace', 'Boosted Pack',
    'Reinforced Mount', 'Custom Kit', 'Optimized Coil', 'Tactical Plate',
  ],
  epic: [
    'Prototype Core', 'Engineered Module', 'Forged Plate', 'Quantum Brace',
    'Advanced Coil', 'Cyclone Module', 'Shadow Coil',
  ],
  legendary: [
    'Apex Drive', 'Singularity Core', 'Phantom Module', 'Ascendant Pack',
  ],
};

/* Random suffix for the placeholder image URL on minted skins. The path
 * doesn't need to be unique (the marketplace/drone-equip fallback only
 * checks the `/placeholder/` prefix, not the filename), but a random
 * suffix keeps minted rows visually grouped with seeded placeholder rows
 * (`/placeholder/legacy_NNN.png`). */
function placeholderImageUrl() {
  const n = Math.floor(Math.random() * 9000) + 1000;
  return `/placeholder/minted_${n}.png`;
}

const MOD_TEMPLATES = [
  // Common (10)
  { name: 'Streamline Plate',  rarity: 'common', bonus: ['speed', 2],            penalty: ['turning', 1] },
  { name: 'Grip Pads',         rarity: 'common', bonus: ['turning', 2],          penalty: ['speed', 1] },
  { name: 'Quick Charge',      rarity: 'common', bonus: ['batteryCapacity', 2],  penalty: ['durability', 1] },
  { name: 'Shock Absorber',    rarity: 'common', bonus: ['durability', 2],       penalty: ['acceleration', 1] },
  { name: 'Steady Module',     rarity: 'common', bonus: ['consistency', 2],      penalty: ['speed', 1] },
  { name: 'Night Lens',        rarity: 'common', bonus: ['nightVision', 2],      penalty: ['rainHandling', 1] },
  { name: 'Rain Shield',       rarity: 'common', bonus: ['rainHandling', 2],     penalty: ['windResistance', 1] },
  { name: 'Wind Fin',          rarity: 'common', bonus: ['windResistance', 2],   penalty: ['nightVision', 1] },
  { name: 'Light Frame',       rarity: 'common', bonus: ['acceleration', 2],     penalty: ['durability', 1] },
  { name: 'Tracker Coil',      rarity: 'common', bonus: ['turning', 2],          penalty: ['batteryCapacity', 1] },
  // Rare (8)
  { name: 'Aero Shell',        rarity: 'rare',   bonus: ['speed', 4],            penalty: ['turning', 2] },
  { name: 'Grip Coating',      rarity: 'rare',   bonus: ['turning', 4],          penalty: ['acceleration', 2] },
  { name: 'Storm Plating',     rarity: 'rare',   bonus: ['rainHandling', 4],     penalty: ['speed', 2] },
  { name: 'Night Optics',      rarity: 'rare',   bonus: ['nightVision', 4],      penalty: ['batteryCapacity', 2] },
  { name: 'Turbo Intake',      rarity: 'rare',   bonus: ['acceleration', 4],     penalty: ['consistency', 2] },
  { name: 'Endurance Core',    rarity: 'rare',   bonus: ['batteryCapacity', 4],  penalty: ['speed', 2] },
  { name: 'Aileron Kit',       rarity: 'rare',   bonus: ['windResistance', 4],   penalty: ['acceleration', 2] },
  { name: 'Stabilizer Brace',  rarity: 'rare',   bonus: ['consistency', 4],      penalty: ['speed', 2] },
  // Epic (5)
  { name: 'Plasma Core',       rarity: 'epic',   bonus: ['acceleration', 6],     penalty: ['consistency', 4] },
  { name: 'Stealth Aero',      rarity: 'epic',   bonus: ['speed', 6],            penalty: ['durability', 4] },
  { name: 'Typhoon Module',    rarity: 'epic',   bonus: ['rainHandling', 8],     penalty: ['speed', 5] },
  { name: 'Predator Lens',     rarity: 'epic',   bonus: ['nightVision', 8],      penalty: ['batteryCapacity', 5] },
  { name: 'Iron Hull',         rarity: 'epic',   bonus: ['durability', 7],       penalty: ['turning', 4] },
  // Legendary (3)
  { name: 'Phantom Drive', rarity: 'legendary', special: 'Ignores battery degradation on lap 1.',           penalty: ['windResistance', 5] },
  { name: 'Quantum Sync',  rarity: 'legendary', special: 'Consistency stat applies double on turn segments.', penalty: ['speed', 4] },
  { name: 'Storm Rider',   rarity: 'legendary', special: 'All weather penalties reduced by 50%.',           penalty: ['acceleration', 6] },
];

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

function modDescription(t) {
  const p = `-${t.penalty[1]}% ${STAT_LABEL[t.penalty[0]] ?? t.penalty[0]}`;
  if (t.rarity === 'legendary') return `${t.special} ${p}.`;
  const b = `+${t.bonus[1]}% ${STAT_LABEL[t.bonus[0]] ?? t.bonus[0]}`;
  return `${b}, ${p}.`;
}

/**
 * Mint a fresh skin row owned by the user. Called when the vault is empty
 * for a given rarity. Pulls a name from SKIN_NAME_POOLS and gives the row
 * a /placeholder/ URL - never reuses one of the hand-curated webp catalog
 * skins, so minted rows can't visually duplicate an Image-Backed Kraken/
 * Diamond Hands/etc. The non-/skins/ URL trips the marketplace + drone-equip
 * fallback render (rarity-tinted swatch instead of webp).
 *
 * Inserted with userId already set, so no CAS is needed.
 */
async function mintSkin(userId, rarity) {
  const pool = SKIN_NAME_POOLS[rarity] ?? SKIN_NAME_POOLS.common;
  const name = pool[Math.floor(Math.random() * pool.length)];
  const [row] = await db
    .insert(skins)
    .values({
      userId,
      name,
      rarity,
      imageUrl: placeholderImageUrl(),
      description: `${name} (minted on demand).`,
    })
    .returning();
  return row;
}

/**
 * Mint a fresh mod row owned by the user. Stat shape (bonus/penalty/
 * special + values) is pulled from a random rarity-matched MOD_TEMPLATES
 * entry so balance is preserved; the surface name comes from MOD_NAME_POOLS
 * so the minted mod isn't a name-duplicate of one of the curated templates.
 * Mods don't carry images (ModPlaceholder hex chip is the canonical render).
 */
async function mintMod(userId, rarity) {
  const templates = MOD_TEMPLATES.filter((t) => t.rarity === rarity);
  const stats = templates[Math.floor(Math.random() * templates.length)];
  const namePool = MOD_NAME_POOLS[rarity] ?? MOD_NAME_POOLS.common;
  const name = namePool[Math.floor(Math.random() * namePool.length)];
  const [row] = await db
    .insert(mods)
    .values({
      userId,
      name,
      rarity,
      description: modDescription(stats),
      statBonusType: stats.bonus ? stats.bonus[0] : null,
      statBonusValue: stats.bonus ? String(stats.bonus[1]) : null,
      statPenaltyType: stats.penalty ? stats.penalty[0] : null,
      statPenaltyValue: stats.penalty ? String(stats.penalty[1]) : null,
      specialAbility: stats.special ?? null,
      imageUrl: null,
    })
    .returning();
  return row;
}

/** Skin pack prices, paid from the player's single wallet. */
export const PACK_PRICES = {
  starter: 2_000,
  premium: 12_000,
  legendary: 60_000,
};

/**
 * Mod capsule prices. Same slot recipe as skin packs (see PACK_SLOTS),
 * priced lower since mods are worth less than skins on the marketplace.
 */
export const MOD_PACK_PRICES = {
  starter: 1_000,
  premium: 6_000,
  legendary: 30_000,
};

/**
 * Legendary skin names withheld from demo (PILOT_*) accounts. The first
 * four are pre-equipped on real player rosters and the last two are
 * marketplace-listed showcase legendaries; demos pull from the
 * complement (Gilded Throne, Samurai, Necromancer) instead.
 */
const DEMO_LEGENDARY_BLOCKLIST = [
  'Kraken',
  'Diamond Hands',
  'Apex Predator',
  'Celestial',
  'Valiant',
];

/**
 * Per-tier slot recipe. A string slot always yields that rarity; an object
 * slot is a probability distribution rolled at open time. Each slot resolves
 * to exactly one item. Used by BOTH skin packs and mod capsules — only the
 * price varies between the two product lines.
 *
 *   starter   = 1 guaranteed common    + 2 wild slots @ 80/17/2.5/0.5
 *   premium   = 1 guaranteed rare      + 2 wild slots @ 40/35/20/5
 *   legendary = slot 1 @ epic 55/legendary 45 + 2 wild slots @ 55/40/5
 */
const PACK_SLOTS = {
  starter: [
    'common',
    { common: 0.80, rare: 0.17, epic: 0.025, legendary: 0.005 },
    { common: 0.80, rare: 0.17, epic: 0.025, legendary: 0.005 },
  ],
  premium: [
    'rare',
    { common: 0.40, rare: 0.35, epic: 0.20, legendary: 0.05 },
    { common: 0.40, rare: 0.35, epic: 0.20, legendary: 0.05 },
  ],
  legendary: [
    { legendary: 0.45, epic: 0.55 },
    { rare: 0.55, epic: 0.40, legendary: 0.05 },
    { rare: 0.55, epic: 0.40, legendary: 0.05 },
  ],
};

function rollDistribution(dist) {
  const roll = Math.random();
  let cum = 0;
  for (const [rarity, p] of Object.entries(dist)) {
    cum += p;
    if (roll < cum) return rarity;
  }
  // Fallback - only hit if probabilities don't sum to 1.
  const keys = Object.keys(dist);
  return keys[keys.length - 1];
}

/** Resolve the 3-slot rarity list for a pack/capsule tier. */
function resolveRarityList(tier) {
  const slots = PACK_SLOTS[tier];
  if (!slots) return null;
  return slots.map((s) => (typeof s === 'string' ? s : rollDistribution(s)));
}

/**
 * Open a skin pack for a player. Validates balance, rolls rarities, picks
 * random unowned skins from the vault, debits the wallet, and assigns the
 * skins to the player. Returns the awarded skin rows + the post-debit
 * balance so the caller can refresh UI without a hard reload.
 *
 * The vault is intentionally infinite from the player's perspective: each
 * slot first tries to CAS-claim an unowned vault row, and falls back to
 * minting a fresh skin via mintSkin() when the vault is empty for that
 * rarity. Packs therefore never fail because supply ran out; the only
 * remaining failure mode is a balance shortfall (rejected before debit)
 * or a low-level DB error during the open (caught + refunded).
 *
 * @param {string} userId
 * @param {'starter'|'premium'|'legendary'} packType
 * @returns {Promise<{ awarded: Array<object>, balance: number }>}
 */
export async function openPack(userId, packType) {
  const price = PACK_PRICES[packType];
  if (!price) throw new ApiError('Unknown pack type', 400);

  const [user] = await db
    .select({ id: users.id, points: users.points, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new ApiError('User not found', 404);
  if (user.points < price) {
    throw new ApiError(
      `Not enough volts. Need +${(price - user.points).toLocaleString()} more.`,
      400,
    );
  }
  const isDemo = user.name?.startsWith('PILOT_') ?? false;

  const rarityList = resolveRarityList(packType);
  if (!rarityList) throw new ApiError('Unknown pack type', 400);

  // No vault availability pre-flight: the slot loop below falls back to
  // mintSkin() whenever the vault is empty for a rarity, so a pack can
  // never fail because supply ran out. Wallet still has its own balance
  // check above.

  // Debit the wallet first - atomic SQL decrement. Refunded on the catch
  // path below if any slot fails to claim.
  await db
    .update(users)
    .set({ points: sql`${users.points} - ${price}` })
    .where(eq(users.id, userId));

  /** @type {Array<object>} skins successfully CAS-claimed for this open. */
  const awarded = [];
  try {
    for (const rarity of rarityList) {
      let claimed = null;
      const skipIds = awarded.map((s) => s.id);
      for (let attempt = 0; attempt < 3 && !claimed; attempt += 1) {
        // Pick a random unowned image-backed skin of this rarity that we
        // haven't already claimed in this same pack-open. Fetch a small
        // candidate pool and pick one at random to reduce the odds of two
        // concurrent opens picking the same row.
        const baseFilters = [
          eq(skins.rarity, rarity),
          isNull(skins.userId),
          like(skins.imageUrl, '/skins/%'),
          like(skins.imageUrl, '%.webp'),
        ];
        if (skipIds.length > 0) {
          baseFilters.push(notInArray(skins.id, skipIds));
        }
        if (isDemo && rarity === 'legendary') {
          baseFilters.push(notInArray(skins.name, DEMO_LEGENDARY_BLOCKLIST));
        }
        const candidates = await db
          .select()
          .from(skins)
          .where(and(...baseFilters))
          .limit(8);
        if (candidates.length === 0) break;
        const candidate =
          candidates[Math.floor(Math.random() * candidates.length)];

        // Atomic CAS: only claim if still unowned. `.returning()` lets us
        // detect whether the row was actually flipped — if another opener
        // beat us to it, returned rows are empty and we retry.
        const claimedRows = await db
          .update(skins)
          .set({ userId })
          .where(and(eq(skins.id, candidate.id), isNull(skins.userId)))
          .returning({ id: skins.id });
        if (claimedRows.length === 1) {
          claimed = candidate;
        }
        // else: lost the race, loop will pick another candidate.
      }

      if (!claimed) {
        // Vault is empty for this rarity (or we lost too many CAS races).
        // Mint a fresh placeholder-imaged row owned by the user so the
        // pack always delivers - vault depletion is invisible to the
        // player. Mint never duplicates an image-backed catalog skin.
        claimed = await mintSkin(userId, rarity);
      }
      awarded.push(claimed);
    }
  } catch (err) {
    // Defensive refund path for DB-level failures (connection drop, insert
    // rejection, etc.). Mint fallback means a skin slot itself shouldn't
    // throw, but the wallet debit + the rest of the open still need a
    // safety net.
    await db
      .update(users)
      .set({ points: sql`${users.points} + ${price}` })
      .where(eq(users.id, userId));
    if (awarded.length > 0) {
      await db
        .update(skins)
        .set({ userId: null })
        .where(inArray(skins.id, awarded.map((s) => s.id)));
    }
    if (err instanceof ApiError) throw err;
    throw new ApiError('Pack open failed, volts refunded.', 500);
  }

  return { awarded, balance: user.points - price };
}

/**
 * Open a mod capsule for a player. Mirrors openPack but targets the mods
 * table. Mods don't carry image_urls (the rarity-tinted ModPlaceholder hex
 * chip is the canonical render), so the imageUrl LIKE filters are dropped.
 *
 * @param {string} userId
 * @param {'starter'|'premium'|'legendary'} tier
 * @returns {Promise<{ awarded: Array<object>, balance: number }>}
 */
export async function openCapsule(userId, tier) {
  const price = MOD_PACK_PRICES[tier];
  if (!price) throw new ApiError('Unknown capsule type', 400);

  const [user] = await db
    .select({ id: users.id, points: users.points, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new ApiError('User not found', 404);
  if (user.points < price) {
    throw new ApiError(
      `Not enough volts. Need +${(price - user.points).toLocaleString()} more.`,
      400,
    );
  }

  const rarityList = resolveRarityList(tier);
  if (!rarityList) throw new ApiError('Unknown capsule type', 400);

  // No vault availability pre-flight: the slot loop below falls back to
  // mintMod() when the vault is empty for a rarity, so a capsule never
  // fails because supply ran out.

  await db
    .update(users)
    .set({ points: sql`${users.points} - ${price}` })
    .where(eq(users.id, userId));

  /** @type {Array<object>} mods CAS-claimed for this open. */
  const awarded = [];
  try {
    for (const rarity of rarityList) {
      let claimed = null;
      const skipIds = awarded.map((m) => m.id);
      for (let attempt = 0; attempt < 3 && !claimed; attempt += 1) {
        const baseFilters = [eq(mods.rarity, rarity), isNull(mods.userId)];
        if (skipIds.length > 0) {
          baseFilters.push(notInArray(mods.id, skipIds));
        }
        const candidates = await db
          .select()
          .from(mods)
          .where(and(...baseFilters))
          .limit(8);
        if (candidates.length === 0) break;
        const candidate =
          candidates[Math.floor(Math.random() * candidates.length)];

        const claimedRows = await db
          .update(mods)
          .set({ userId })
          .where(and(eq(mods.id, candidate.id), isNull(mods.userId)))
          .returning({ id: mods.id });
        if (claimedRows.length === 1) {
          claimed = candidate;
        }
      }

      if (!claimed) {
        // Vault empty / lost too many CAS races - mint a fresh mod row
        // owned by the user so the capsule always delivers.
        claimed = await mintMod(userId, rarity);
      }
      awarded.push(claimed);
    }
  } catch (err) {
    // Defensive refund path for DB-level failures only.
    await db
      .update(users)
      .set({ points: sql`${users.points} + ${price}` })
      .where(eq(users.id, userId));
    if (awarded.length > 0) {
      await db
        .update(mods)
        .set({ userId: null })
        .where(inArray(mods.id, awarded.map((m) => m.id)));
    }
    if (err instanceof ApiError) throw err;
    throw new ApiError('Capsule open failed, volts refunded.', 500);
  }

  return { awarded, balance: user.points - price };
}
