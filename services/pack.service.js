import { and, eq, inArray, isNull, like, notInArray, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { ApiError } from '@/lib/api/response.js';

const { users, skins } = schema;

/** Pack prices, paid from the player's single wallet. */
export const PACK_PRICES = {
  starter: 500,
  premium: 2_000,
  legendary: 10_000,
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
 * Per-pack rarity slot recipe. A string slot always yields that rarity; an
 * object slot is a probability distribution rolled at open time. Each slot
 * resolves to exactly one skin.
 */
const PACK_SLOTS = {
  starter: [
    'common',
    'common',
    { rare: 0.7, epic: 0.25, legendary: 0.05 },
  ],
  premium: [
    'rare',
    { epic: 0.6, legendary: 0.4 },
    { common: 0.4, rare: 0.35, epic: 0.2, legendary: 0.05 },
  ],
  legendary: [
    'epic',
    'legendary',
    { rare: 0.3, epic: 0.5, legendary: 0.2 },
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

/** Resolve the 3-slot rarity list for a pack type. */
function resolveRarityList(packType) {
  const slots = PACK_SLOTS[packType];
  if (!slots) return null;
  return slots.map((s) => (typeof s === 'string' ? s : rollDistribution(s)));
}

/**
 * Open a pack for a player. Validates balance, rolls rarities, picks random
 * unowned skins from the vault, debits the wallet, and assigns the skins to
 * the player. Returns the awarded skin rows.
 *
 * Neon HTTP has no transactions, so the sequence is: (a) verify availability
 * up-front to avoid charging without delivery, (b) debit wallet, (c) assign
 * skins. A failure between (b) and (c) could leave the player short on
 * assignment; surface via log + toast.
 *
 * @param {string} userId
 * @param {'starter'|'premium'|'legendary'} packType
 * @returns {Promise<Array<object>>} awarded skin rows
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

  return awarded;
}
