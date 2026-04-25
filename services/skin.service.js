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
 * Apply a skin to a drone. Skin binding is permanent: once a skin is
 * applied to a drone, it cannot be removed, transferred to another
 * drone, or listed independently on the marketplace. Sale of the drone
 * carries the skin with it.
 *
 * Therefore applySkin is rejected if either:
 *   - the skin is already bound to any drone (by reverse lookup), or
 *   - the target drone already has a skin applied.
 *
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

  if (drone.appliedSkinId) {
    throw new ApiError(
      'This drone already has a skin equipped. Skins are permanently bound and cannot be replaced.',
      400,
    );
  }

  const [boundElsewhere] = await db
    .select({ id: drones.id })
    .from(drones)
    .where(eq(drones.appliedSkinId, skinId))
    .limit(1);
  if (boundElsewhere) {
    throw new ApiError(
      'This skin is already bound to another drone and cannot be transferred.',
      400,
    );
  }

  const [updated] = await db
    .update(drones)
    .set({ appliedSkinId: skinId })
    .where(eq(drones.id, droneId))
    .returning();

  return updated;
}

/**
 * Skin removal is disabled: skins are permanently bound to drones once
 * applied. Kept exported so callers get a clear 400 instead of a 404.
 * @param {string} _userId
 * @param {string} _droneId
 */
export async function removeSkin(_userId, _droneId) {
  throw new ApiError(
    'Skins are permanently bound to drones and cannot be removed.',
    400,
  );
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
