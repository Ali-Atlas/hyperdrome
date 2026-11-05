import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';

const { skins, droneSkins } = schema;

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Skins owned by the user. Each row is enriched with `boundDroneId` (the
 * drone the skin is bound to, or null if unbound and freely listable).
 * Mirrors the mod service shape so the marketplace listing modal can
 * filter `!s.boundDroneId` the same way it does for mods.
 *
 * @param {string} userId
 */
export async function getUserSkins(userId) {
  const owned = await db
    .select()
    .from(skins)
    .where(eq(skins.userId, userId))
    .orderBy(desc(skins.createdAt));

  if (owned.length === 0) return [];

  const ids = owned.map((s) => s.id);
  const bindings = await db
    .select({ skinId: droneSkins.skinId, droneId: droneSkins.droneId })
    .from(droneSkins)
    .where(inArray(droneSkins.skinId, ids));
  const bindMap = Object.fromEntries(bindings.map((b) => [b.skinId, b.droneId]));

  return owned.map((s) => ({ ...s, boundDroneId: bindMap[s.id] ?? null }));
}

/**
 * All skins bound to a drone, with the equipped flag and joined skin
 * details. Used by the drone management page skin-selector and by any
 * non-owner read of a listed drone's collection.
 * @param {string} droneId
 */
export async function getDroneSkins(droneId) {
  const rows = await db
    .select({
      bindingId: droneSkins.id,
      isEquipped: droneSkins.isEquipped,
      skin: skins,
    })
    .from(droneSkins)
    .innerJoin(skins, eq(droneSkins.skinId, skins.id))
    .where(eq(droneSkins.droneId, droneId))
    .orderBy(desc(droneSkins.createdAt));

  return rows.map(({ bindingId, isEquipped, skin }) => ({
    ...skin,
    bindingId,
    isEquipped,
  }));
}

/**
 * Find the unbound skins (no drone_skins row) owned by the user. Used by
 * the marketplace list-item flow to constrain which skins can be sold.
 * @param {string} userId
 */
export async function getUnboundUserSkins(userId) {
  const all = await getUserSkins(userId);
  return all.filter((s) => s.boundDroneId == null);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Award a random unowned image-backed skin of the given rarity to a user.
 * Restricted to skins whose `image_url` points to a real `/skins/...webp`
 * file so race drops + pack drops only yield real designed skins, not the
 * legacy placeholder rows.
 * Returns the granted skin, or null if none are available in that pool.
 * @param {string} userId
 * @param {'common'|'rare'|'epic'|'legendary'} rarity
 */
export async function awardSkinDrop(userId, rarity) {
  const unowned = await db
    .select()
    .from(skins)
    .where(
      and(
        eq(skins.rarity, rarity),
        sql`${skins.userId} IS NULL`,
        like(skins.imageUrl, '/skins/%'),
        like(skins.imageUrl, '%.webp')
      )
    )
    .limit(1);
  if (unowned.length === 0) return null;

  const [updated] = await db
    .update(skins)
    .set({ userId })
    .where(eq(skins.id, unowned[0].id))
    .returning();
  return updated;
}
