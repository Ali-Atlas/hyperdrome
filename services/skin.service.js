import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { ApiError } from '@/lib/api/response.js';

const { skins, drones } = schema;

/** Skins owned by a user. */
export async function getUserSkins(userId) {
  return db
    .select()
    .from(skins)
    .where(eq(skins.userId, userId))
    .orderBy(desc(skins.createdAt));
}

/**
 * Apply a skin to a drone. User must own both.
 * @param {string} userId
 * @param {string} skinId
 * @param {string} droneId
 */
export async function applySkin(userId, skinId, droneId) {
  const [skin] = await db
    .select()
    .from(skins)
    .where(eq(skins.id, skinId))
    .limit(1);
  if (!skin) throw new ApiError('Skin not found', 404);
  if (skin.userId !== userId) throw new ApiError('You do not own this skin', 403);

  const [drone] = await db
    .select()
    .from(drones)
    .where(eq(drones.id, droneId))
    .limit(1);
  if (!drone) throw new ApiError('Drone not found', 404);
  if (drone.userId !== userId) throw new ApiError('You do not own this drone', 403);

  const [updated] = await db
    .update(drones)
    .set({ appliedSkinId: skinId })
    .where(eq(drones.id, droneId))
    .returning();

  return updated;
}

/**
 * Unequip the currently applied skin from a drone.
 * @param {string} userId
 * @param {string} droneId
 */
export async function removeSkin(userId, droneId) {
  const [drone] = await db
    .select()
    .from(drones)
    .where(eq(drones.id, droneId))
    .limit(1);
  if (!drone) throw new ApiError('Drone not found', 404);
  if (drone.userId !== userId) throw new ApiError('You do not own this drone', 403);

  const [updated] = await db
    .update(drones)
    .set({ appliedSkinId: null })
    .where(eq(drones.id, droneId))
    .returning();

  return updated;
}

/**
 * Award a random unowned skin of the given rarity to a user.
 * Returns the granted skin, or null if none are available in that pool.
 * @param {string} userId
 * @param {'common'|'rare'|'epic'|'legendary'} rarity
 */
export async function awardSkinDrop(userId, rarity) {
  const unowned = await db
    .select()
    .from(skins)
    .where(and(eq(skins.rarity, rarity), sql`${skins.userId} IS NULL`))
    .limit(1);
  if (unowned.length === 0) return null;

  const [updated] = await db
    .update(skins)
    .set({ userId })
    .where(eq(skins.id, unowned[0].id))
    .returning();
  return updated;
}
