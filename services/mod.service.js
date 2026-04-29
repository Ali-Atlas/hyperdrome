import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { ApiError } from '@/lib/api/response.js';

const { mods, droneMods, drones } = schema;

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * All mods owned by a user. Each row is enriched with `boundDroneId` (the
 * drone the mod is bound to, or null if unbound and freely listable).
 *
 * @param {string} userId
 */
export async function getUserMods(userId) {
  const owned = await db
    .select()
    .from(mods)
    .where(eq(mods.userId, userId))
    .orderBy(desc(mods.createdAt));

  if (owned.length === 0) return [];

  const ids = owned.map((m) => m.id);
  const bindings = await db
    .select({ modId: droneMods.modId, droneId: droneMods.droneId })
    .from(droneMods)
    .where(inArray(droneMods.modId, ids));
  const bindMap = Object.fromEntries(
    bindings.map((b) => [b.modId, b.droneId]),
  );

  return owned.map((m) => ({ ...m, boundDroneId: bindMap[m.id] ?? null }));
}

/** Single mod by id. */
export async function getModById(modId) {
  const [row] = await db
    .select()
    .from(mods)
    .where(eq(mods.id, modId))
    .limit(1);
  if (!row) throw new ApiError('Mod not found', 404);
  return row;
}

/**
 * All mods bound to a drone, with the equipped flag and joined mod details.
 * Used by the drone management page mod-selector and by race displays.
 * @param {string} droneId
 */
export async function getDroneMods(droneId) {
  const rows = await db
    .select({
      bindingId: droneMods.id,
      isEquipped: droneMods.isEquipped,
      mod: mods,
    })
    .from(droneMods)
    .innerJoin(mods, eq(droneMods.modId, mods.id))
    .where(eq(droneMods.droneId, droneId))
    .orderBy(desc(droneMods.createdAt));

  return rows.map(({ bindingId, isEquipped, mod }) => ({
    ...mod,
    bindingId,
    isEquipped,
  }));
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Bind an unbound owned mod to one of the user's drones. Permanent: once
 * bound, the mod cannot be transferred to another drone or listed
 * independently (it transfers with the drone on sale).
 *
 * The newly bound mod becomes the equipped one if the drone has no
 * currently equipped mod; otherwise it joins the collection without
 * replacing the active mod.
 *
 * @param {string} userId
 * @param {string} modId
 * @param {string} droneId
 */
export async function bindMod(userId, modId, droneId) {
  const [mod] = await db
    .select()
    .from(mods)
    .where(eq(mods.id, modId))
    .limit(1);
  if (!mod) throw new ApiError('Mod not found', 404);
  if (mod.userId !== userId) {
    throw new ApiError('You do not own this mod', 403);
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

  // Reject if already bound anywhere - including this same drone or another.
  const [existing] = await db
    .select({ id: droneMods.id })
    .from(droneMods)
    .where(eq(droneMods.modId, modId))
    .limit(1);
  if (existing) {
    throw new ApiError(
      'This mod is already bound to a drone and cannot be re-bound.',
      400,
    );
  }

  // Binding now always equips, replacing whatever was previously equipped.
  // Captain spec: bind means "I want to use this." Mods don't depend on
  // tier renders, so every bound mod is equippable.
  await db
    .update(droneMods)
    .set({ isEquipped: false })
    .where(eq(droneMods.droneId, droneId));

  await db.insert(droneMods).values({
    droneId,
    modId,
    isEquipped: true,
  });

  await db
    .update(drones)
    .set({ appliedModId: modId })
    .where(eq(drones.id, droneId));

  return { droneId, modId, isEquipped: true };
}

/**
 * Equip a different mod from the drone's bound collection, or unequip the
 * currently-equipped mod when `modId` is null. In the unequip path, all
 * of the drone's droneMods rows get is_equipped=false and
 * drones.applied_mod_id is cleared; bound mods stay in the collection.
 *
 * @param {string} userId
 * @param {string} droneId
 * @param {string|null} modId
 */
export async function equipMod(userId, droneId, modId) {
  const [drone] = await db
    .select()
    .from(drones)
    .where(eq(drones.id, droneId))
    .limit(1);
  if (!drone) throw new ApiError('Drone not found', 404);
  if (drone.userId !== userId) {
    throw new ApiError('You do not own this drone', 403);
  }

  if (modId == null) {
    await db
      .update(droneMods)
      .set({ isEquipped: false })
      .where(eq(droneMods.droneId, droneId));
    await db
      .update(drones)
      .set({ appliedModId: null })
      .where(eq(drones.id, droneId));
    return { droneId, modId: null };
  }

  const [binding] = await db
    .select()
    .from(droneMods)
    .where(and(eq(droneMods.droneId, droneId), eq(droneMods.modId, modId)))
    .limit(1);
  if (!binding) {
    throw new ApiError('This mod is not bound to this drone', 400);
  }

  await db
    .update(droneMods)
    .set({ isEquipped: false })
    .where(eq(droneMods.droneId, droneId));

  await db
    .update(droneMods)
    .set({ isEquipped: true })
    .where(and(eq(droneMods.droneId, droneId), eq(droneMods.modId, modId)));

  await db
    .update(drones)
    .set({ appliedModId: modId })
    .where(eq(drones.id, droneId));

  return { droneId, modId };
}

/**
 * Find the unbound mods (no drone_mods row) owned by the user. Used by the
 * marketplace list-item flow to constrain which mods can be sold.
 * @param {string} userId
 */
export async function getUnboundUserMods(userId) {
  const all = await getUserMods(userId);
  return all.filter((m) => m.boundDroneId == null);
}
