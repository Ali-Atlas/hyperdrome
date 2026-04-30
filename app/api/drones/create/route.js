import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import { buildLowRangeStats } from '@/lib/game-engine/drone-spawn.js';
import { generateUniqueDroneName } from '@/lib/game-engine/drone-names.js';
import {
  calculateXPToNextLevel,
  calculateTSB,
} from '@/lib/game-engine/economy.js';
import { cloneVaultItemToUser } from '@/services/race.service.js';

const {
  users,
  drones,
  droneSkins,
  droneMods,
  droneOwnershipHistory,
} = schema;

const DRONE_PRICE = 3500;

/**
 * NPC vendor: 3,500V buys a fresh LV1 drone with mid-range stats and
 * one common skin + one common mod cloned from the vault, both bound
 * to the new drone (not equipped). The buyer activates manually if
 * they have an open slot.
 */
async function handler({ session }) {
  const userId = session.user.id;

  const [user] = await db
    .select({ points: users.points })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new ApiError('User not found', 404);
  if (user.points < DRONE_PRICE) {
    throw new ApiError('Insufficient volts', 400);
  }

  // Debit first so a downstream insert failure can't yield a free drone.
  // No transactions on Neon HTTP - the order matters.
  await db
    .update(users)
    .set({ points: sql`${users.points} - ${DRONE_PRICE}` })
    .where(eq(users.id, userId));
  const balance = user.points - DRONE_PRICE;

  const stats = buildLowRangeStats(1, 5);
  const name = await generateUniqueDroneName(db, drones);
  const [drone] = await db
    .insert(drones)
    .values({
      userId,
      name,
      level: 1,
      xp: 0,
      xpToNextLevel: calculateXPToNextLevel(1),
      totalStatBudget: calculateTSB(1),
      ...stats,
      active: false,
      isBot: false,
    })
    .returning();

  await db.insert(droneOwnershipHistory).values({
    droneId: drone.id,
    ownerUserId: userId,
    transactionType: 'purchase',
    pricePaid: DRONE_PRICE,
  });

  const skin = await cloneVaultItemToUser(userId, 'skin', 'common');
  if (skin) {
    await db.insert(droneSkins).values({
      droneId: drone.id,
      skinId: skin.id,
      isEquipped: false,
    });
  }

  const mod = await cloneVaultItemToUser(userId, 'mod', 'common');
  if (mod) {
    await db.insert(droneMods).values({
      droneId: drone.id,
      modId: mod.id,
      isEquipped: false,
    });
  }

  return ok({
    drone,
    boundSkinId: skin?.id ?? null,
    boundModId: mod?.id ?? null,
    balance,
  });
}

export const POST = withApiHandler(handler);
