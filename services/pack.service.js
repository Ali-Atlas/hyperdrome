import { and, eq, isNull, like, sql } from 'drizzle-orm';
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
    .select({ id: users.id, points: users.points })
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

  const rarityList = resolveRarityList(packType);
  if (!rarityList) throw new ApiError('Unknown pack type', 400);

  // Count skins needed per rarity.
  const counts = {};
  for (const r of rarityList) counts[r] = (counts[r] || 0) + 1;

  // Pre-fetch candidate pools + confirm enough available of each rarity
  // before we charge the player.
  const awarded = [];
  for (const [rarity, count] of Object.entries(counts)) {
    // Restrict drops to image-backed skins so packs only yield real
     // designed skins, never the legacy placeholder rows whose image_url
     // points to non-existent paths.
    const candidates = await db
      .select()
      .from(skins)
      .where(
        and(
          eq(skins.rarity, rarity),
          isNull(skins.userId),
          like(skins.imageUrl, '/skins/%'),
          like(skins.imageUrl, '%.webp'),
        ),
      )
      .limit(count * 4);
    if (candidates.length < count) {
      throw new ApiError(
        `Not enough ${rarity} skins available in the vault. Try again later.`,
        400,
      );
    }
    // Fisher-Yates shuffle then take the first `count`.
    const shuffled = [...candidates];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    awarded.push(...shuffled.slice(0, count));
  }

  // Debit the wallet first - atomic SQL decrement.
  await db
    .update(users)
    .set({ points: sql`${users.points} - ${price}` })
    .where(eq(users.id, userId));

  // Assign the skins to the user. Best-effort on Neon HTTP (no txns).
  for (const skin of awarded) {
    await db
      .update(skins)
      .set({ userId })
      .where(eq(skins.id, skin.id));
  }

  return awarded;
}
