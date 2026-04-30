import { and, eq, inArray, isNull, like, notInArray, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { ApiError } from '@/lib/api/response.js';

const { users, skins, mods } = schema;

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
 * Neon HTTP has no transactions, so the sequence is: (a) verify availability
 * up-front to avoid charging without delivery, (b) debit wallet, (c) assign
 * skins. The catch path refunds + releases on any failure between (b)/(c).
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

  // Count skins needed per rarity for the pre-flight availability check.
  const counts = {};
  for (const r of rarityList) counts[r] = (counts[r] || 0) + 1;

  // Pre-flight: confirm the vault has at least `count` unowned image-backed
  // skins for each rarity in the list. This is a cheap availability gate
  // before we touch the wallet; the actual claim still uses an atomic CAS
  // (see below) since another concurrent open could grab one between this
  // check and the assignment.
  for (const [rarity, count] of Object.entries(counts)) {
    const conditions = [
      eq(skins.rarity, rarity),
      isNull(skins.userId),
      like(skins.imageUrl, '/skins/%'),
      like(skins.imageUrl, '%.webp'),
    ];
    if (isDemo && rarity === 'legendary') {
      conditions.push(notInArray(skins.name, DEMO_LEGENDARY_BLOCKLIST));
    }
    const [{ available }] = await db
      .select({ available: sql`count(*)::int` })
      .from(skins)
      .where(and(...conditions));
    if (available < count) {
      throw new ApiError(
        `Not enough ${rarity} skins available in the vault. Try again later.`,
        400,
      );
    }
  }

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
        // All retries exhausted for this slot — bail out so the catch
        // refunds the wallet and releases anything we did claim.
        throw new ApiError('Skin unavailable, volts refunded.', 409);
      }
      awarded.push(claimed);
    }
  } catch (err) {
    // Refund the full price.
    await db
      .update(users)
      .set({ points: sql`${users.points} + ${price}` })
      .where(eq(users.id, userId));
    // Release any skins we successfully claimed before the failure so they
    // return to the unowned vault for other openers.
    if (awarded.length > 0) {
      await db
        .update(skins)
        .set({ userId: null })
        .where(inArray(skins.id, awarded.map((s) => s.id)));
    }
    if (err instanceof ApiError) throw err;
    throw new ApiError('Skin unavailable, volts refunded.', 409);
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

  const counts = {};
  for (const r of rarityList) counts[r] = (counts[r] || 0) + 1;

  // Pre-flight: vault availability per rarity. No imageUrl filter — mods
  // render via ModPlaceholder, not webp.
  for (const [rarity, count] of Object.entries(counts)) {
    const [{ available }] = await db
      .select({ available: sql`count(*)::int` })
      .from(mods)
      .where(and(eq(mods.rarity, rarity), isNull(mods.userId)));
    if (available < count) {
      throw new ApiError(
        `Not enough ${rarity} mods available in the vault. Try again later.`,
        400,
      );
    }
  }

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
        throw new ApiError('Mod unavailable, volts refunded.', 409);
      }
      awarded.push(claimed);
    }
  } catch (err) {
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
    throw new ApiError('Mod unavailable, volts refunded.', 409);
  }

  return { awarded, balance: user.points - price };
}
