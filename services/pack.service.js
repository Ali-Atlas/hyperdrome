import { and, eq, inArray, isNull, like, notInArray, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { ApiError } from '@/lib/api/response.js';

const { users, skins, mods } = schema;

/* -------------------------------------------------------------------------- */
/* On-demand catalogs                                                         */
/*                                                                            */
/* Mirrored from scripts/seed-production.js so a pack open can mint a fresh   */
/* row when the vault is empty for a given rarity. The vault is intentionally */
/* infinite from the player's perspective: drained vaults transparently mint  */
/* new rows on the fly instead of erroring. Keep these tables in lock-step    */
/* with seed-production.js#IMAGE_BACKED_SKINS and #MOD_TEMPLATES — they're    */
/* the source of truth for skin imagery (webp paths must exist in            */
/* public/skins/) and mod stat treatments (description string is computed    */
/* the same way as the seeder).                                               */
/* -------------------------------------------------------------------------- */

const IMAGE_BACKED_SKINS = [
  // Common (8)
  { name: 'Bone',        rarity: 'common',    imageUrl: '/skins/common/bone.webp' },
  { name: 'Cobalt',      rarity: 'common',    imageUrl: '/skins/common/cobalt.webp' },
  { name: 'Dusk',        rarity: 'common',    imageUrl: '/skins/common/dusk.webp' },
  { name: 'Ember',       rarity: 'common',    imageUrl: '/skins/common/ember.webp' },
  { name: 'Frost',       rarity: 'common',    imageUrl: '/skins/common/frost.webp' },
  { name: 'Rust',        rarity: 'common',    imageUrl: '/skins/common/rust.webp' },
  { name: 'Shadow',      rarity: 'common',    imageUrl: '/skins/common/shadow.webp' },
  { name: 'Venom',       rarity: 'common',    imageUrl: '/skins/common/venom.webp' },
  // Rare (8)
  { name: 'Anodized Blaze', rarity: 'rare',   imageUrl: '/skins/rare/anodized_blaze.webp' },
  { name: 'Arctic Fury',    rarity: 'rare',   imageUrl: '/skins/rare/arctic_fury.webp' },
  { name: 'Chrome Fury',    rarity: 'rare',   imageUrl: '/skins/rare/chrome_fury.webp' },
  { name: 'Copper King',    rarity: 'rare',   imageUrl: '/skins/rare/copper_king.webp' },
  { name: 'Gunmetal Storm', rarity: 'rare',   imageUrl: '/skins/rare/gunmetal_storm.webp' },
  { name: 'Jade Circuit',   rarity: 'rare',   imageUrl: '/skins/rare/jade_circuit.webp' },
  { name: 'Midnight Oil',   rarity: 'rare',   imageUrl: '/skins/rare/midnight_oil.webp' },
  { name: 'Titanium Ghost', rarity: 'rare',   imageUrl: '/skins/rare/titanium_ghost.webp' },
  // Epic (8)
  { name: 'Crystal Phantom',    rarity: 'epic', imageUrl: '/skins/epic/crystal_phantom.webp' },
  { name: 'Dragon Scale',       rarity: 'epic', imageUrl: '/skins/epic/dragon_scale.webp' },
  { name: 'Frozen Abyss',       rarity: 'epic', imageUrl: '/skins/epic/frozen_abyss.webp' },
  { name: 'Iridescent Wraith',  rarity: 'epic', imageUrl: '/skins/epic/iridescent_wraith.webp' },
  { name: 'Liquid Mercury',     rarity: 'epic', imageUrl: '/skins/epic/liquid_mercury.webp' },
  { name: 'Obsidian Core',      rarity: 'epic', imageUrl: '/skins/epic/obsidian_core.webp' },
  { name: 'Solar Flare',        rarity: 'epic', imageUrl: '/skins/epic/solar_flare.webp' },
  { name: 'Void Bloom',         rarity: 'epic', imageUrl: '/skins/epic/void_bloom.webp' },
  // Legendary (8)
  { name: 'Apex Predator', rarity: 'legendary', imageUrl: '/skins/legendary/apex_predator.webp' },
  { name: 'Celestial',     rarity: 'legendary', imageUrl: '/skins/legendary/celestial.webp' },
  { name: 'Diamond Hands', rarity: 'legendary', imageUrl: '/skins/legendary/diamond_hand.webp' },
  { name: 'Gilded Throne', rarity: 'legendary', imageUrl: '/skins/legendary/gilded_throne.webp' },
  { name: 'Kraken',        rarity: 'legendary', imageUrl: '/skins/legendary/kraken.webp' },
  { name: 'Necromancer',   rarity: 'legendary', imageUrl: '/skins/legendary/necromancer.webp' },
  { name: 'Samurai',       rarity: 'legendary', imageUrl: '/skins/legendary/samurai.webp' },
  { name: 'Valiant',       rarity: 'legendary', imageUrl: '/skins/legendary/valiant.webp' },
];

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
 * for a given rarity. Picks a random catalog entry (filtered by the demo
 * blocklist when applicable) and inserts the row already assigned, so no
 * CAS is needed - this row was created for this player. The new row is
 * just a regular owned skin from that point on; refunds release it back
 * to the vault like any other.
 */
async function mintSkin(userId, rarity, isDemo) {
  let pool = IMAGE_BACKED_SKINS.filter((t) => t.rarity === rarity);
  if (isDemo && rarity === 'legendary') {
    pool = pool.filter((t) => !DEMO_LEGENDARY_BLOCKLIST.includes(t.name));
  }
  const template = pool[Math.floor(Math.random() * pool.length)];
  const [row] = await db
    .insert(skins)
    .values({
      userId,
      name: template.name,
      rarity: template.rarity,
      imageUrl: template.imageUrl,
    })
    .returning();
  return row;
}

/** Mint a fresh mod row owned by the user. Mirrors mintSkin. */
async function mintMod(userId, rarity) {
  const pool = MOD_TEMPLATES.filter((t) => t.rarity === rarity);
  const template = pool[Math.floor(Math.random() * pool.length)];
  const [row] = await db
    .insert(mods)
    .values({
      userId,
      name: template.name,
      rarity: template.rarity,
      description: modDescription(template),
      statBonusType: template.bonus ? template.bonus[0] : null,
      statBonusValue: template.bonus ? String(template.bonus[1]) : null,
      statPenaltyType: template.penalty ? template.penalty[0] : null,
      statPenaltyValue: template.penalty ? String(template.penalty[1]) : null,
      specialAbility: template.special ?? null,
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
        // Mint a fresh row owned by the user so the pack always delivers
        // a valid skin - vault depletion is invisible to the player.
        claimed = await mintSkin(userId, rarity, isDemo);
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
