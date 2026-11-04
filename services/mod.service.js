import { desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/lib/db';

const { mods, droneMods } = schema;

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
  const bindMap = Object.fromEntries(bindings.map((b) => [b.modId, b.droneId]));

  return owned.map((m) => ({ ...m, boundDroneId: bindMap[m.id] ?? null }));
}
