import { and, asc, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { ApiError } from '@/lib/api/response.js';
import { canEquipSkin } from '@/lib/utils.js';

const { skins, drones, droneSkins, races } = schema;

/**
 * True iff the drone has a PENDING race whose strategy window has closed
 * (scheduled_at has been reached). Mirrors the same check in mod.service.js;
 * both services duplicate the helper rather than sharing a third file so
 * the equip-path lock stays a one-file concern per service.
 *
 * @param {string} droneId
 * @returns {Promise<boolean>}
 */
async function isDroneLockedForRace(droneId) {
  const [row] = await db
    .select({ id: races.id })
    .from(races)
    .where(
      and(
        or(eq(races.drone1Id, droneId), eq(races.drone2Id, droneId)),
        eq(races.status, 'pending'),
        sql`${races.scheduledAt} <= NOW()`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

const LOCKED_FOR_RACE_MESSAGE =
  'Drone is locked for an upcoming race. Changes will be available after the race completes.';

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
  const bindMap = Object.fromEntries(
    bindings.map((b) => [b.skinId, b.droneId]),
  );

  return owned.map((s) => ({ ...s, boundDroneId: bindMap[s.id] ?? null }));
}

/**
 * Catalog of all image-backed skins (`image_url` matches `/skins/...webp`).
 * Returns every image-backed row regardless of ownership - the marketplace
 * uses this to populate the "WHAT YOU COULD PULL" preview cards on each
 * pack. Excludes the legacy placeholder skins whose `image_url` points to
 * non-existent paths (those still render as SkinMini SVG fallbacks
 * elsewhere; they're not droppable from packs).
 */
export async function getCatalogImageBacked() {
  return db
    .select({
      id: skins.id,
      name: skins.name,
      rarity: skins.rarity,
      imageUrl: skins.imageUrl,
    })
    .from(skins)
    .where(and(like(skins.imageUrl, '/skins/%'), like(skins.imageUrl, '%.webp')))
    .orderBy(asc(skins.rarity), asc(skins.name));
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
 * Bind an unbound owned skin to one of the user's drones. Permanent: once
 * bound, the skin cannot be transferred to another drone or listed
 * independently (it transfers with the drone on sale).
 *
 * The newly bound skin becomes the equipped one if the drone has no
 * currently equipped skin; otherwise it joins the collection without
 * replacing the active skin.
 *
 * @param {string} userId
 * @param {string} skinId
 * @param {string} droneId
 */
export async function bindSkinToDrone(userId, skinId, droneId) {
  const [skin] = await db
    .select()
    .from(skins)
    .where(eq(skins.id, skinId))
    .limit(1);
  if (!skin) throw new ApiError('Skin not found', 404);
  if (skin.userId !== userId) {
    throw new ApiError('You do not own this skin', 403);
  }

  const [drone] = await db
    .select()
    .from(drones)
    .where(eq(drones.id, droneId))
    .limit(1);
  if (!drone) throw new ApiError('Drone not found', 404);
  if (drone.userId !== userId) {
    throw new ApiError('You do not own this drone', 403);
  }

  // Reject if already bound anywhere - this drone or another.
  const [existing] = await db
    .select({ id: droneSkins.id })
    .from(droneSkins)
    .where(eq(droneSkins.skinId, skinId))
    .limit(1);
  if (existing) {
    throw new ApiError(
      'This skin is already bound to a drone and cannot be re-bound.',
      400,
    );
  }

  // Binding equips the skin only when it's renderable on this drone's
  // tier AND the drone isn't locked into a pending race past its
  // scheduled time. Non-renderable skins bind without equipping (the
  // user keeps them in the collection but the drone keeps its current
  // visual). Lock-bypass guard mirrors equipSkin: if the drone's
  // matchup is queued and waiting on the cron tick, mods/skins are
  // frozen until the race completes - the bind still succeeds so the
  // collection updates, just without the auto-equip side effect.
  const locked = await isDroneLockedForRace(droneId);
  const shouldEquip = canEquipSkin(skin, drone.level) && !locked;

  if (shouldEquip) {
    // Clear any currently-equipped skin on this drone so the new one is
    // the sole equipped row in droneSkins.
    await db
      .update(droneSkins)
      .set({ isEquipped: false })
      .where(eq(droneSkins.droneId, droneId));
  }

  await db.insert(droneSkins).values({
    droneId,
    skinId,
    isEquipped: shouldEquip,
  });

  // Belt-and-suspenders: re-affirm ownership on the skin row. In the
  // normal flow skins.userId already equals userId here (we just verified
  // it above), but writing defensively keeps the invariant explicit.
  await db
    .update(skins)
    .set({ userId })
    .where(eq(skins.id, skinId));

  if (shouldEquip) {
    await db
      .update(drones)
      .set({ appliedSkinId: skinId })
      .where(eq(drones.id, droneId));
  }

  return { droneId, skinId, isEquipped: shouldEquip };
}

/**
 * Equip a different skin from the drone's bound collection, or unequip
 * the currently-equipped skin when `skinId` is null. In the unequip path,
 * all of the drone's droneSkins rows get is_equipped=false and
 * drones.applied_skin_id is cleared; bound skins stay in the collection.
 *
 * @param {string} userId
 * @param {string} droneId
 * @param {string|null} skinId
 */
export async function equipSkin(userId, droneId, skinId) {
  const [drone] = await db
    .select()
    .from(drones)
    .where(eq(drones.id, droneId))
    .limit(1);
  if (!drone) throw new ApiError('Drone not found', 404);
  if (drone.userId !== userId) {
    throw new ApiError('You do not own this drone', 403);
  }

  // Mod lock applies to skins too: once a pending race for this drone
  // crosses scheduled_at, every loadout-mutating endpoint rejects until
  // the race completes. Covers both equip (skinId set) and unequip
  // (skinId === null) since the check sits before the null branch.
  if (await isDroneLockedForRace(droneId)) {
    throw new ApiError(LOCKED_FOR_RACE_MESSAGE, 409);
  }

  if (skinId == null) {
    await db
      .update(droneSkins)
      .set({ isEquipped: false })
      .where(eq(droneSkins.droneId, droneId));
    await db
      .update(drones)
      .set({ appliedSkinId: null })
      .where(eq(drones.id, droneId));
    return { droneId, skinId: null };
  }

  const [binding] = await db
    .select()
    .from(droneSkins)
    .where(and(eq(droneSkins.droneId, droneId), eq(droneSkins.skinId, skinId)))
    .limit(1);
  if (!binding) {
    throw new ApiError('This skin is not bound to this drone', 400);
  }

  const [skin] = await db
    .select()
    .from(skins)
    .where(eq(skins.id, skinId))
    .limit(1);
  if (!skin) throw new ApiError('Skin not found', 404);
  if (!canEquipSkin(skin, drone.level)) {
    throw new ApiError('Not available in demo.', 400);
  }

  await db
    .update(droneSkins)
    .set({ isEquipped: false })
    .where(eq(droneSkins.droneId, droneId));

  await db
    .update(droneSkins)
    .set({ isEquipped: true })
    .where(and(eq(droneSkins.droneId, droneId), eq(droneSkins.skinId, skinId)));

  await db
    .update(drones)
    .set({ appliedSkinId: skinId })
    .where(eq(drones.id, droneId));

  return { droneId, skinId };
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
        like(skins.imageUrl, '%.webp'),
      ),
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
