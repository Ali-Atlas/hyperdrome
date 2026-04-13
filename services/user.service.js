import { desc, eq, or, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { ApiError } from '@/lib/api/response.js';

const { users, drones, races, skins } = schema;

/**
 * Public profile for a user — profile fields + owned drones + recent races + skins.
 * @param {string} userId
 */
export async function getUserProfile(userId) {
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      createdAt: users.createdAt,
      image: users.image,
      imageUrl: users.imageUrl,
      points: users.points,
      totalRaces: users.totalRaces,
      totalWins: users.totalWins,
      eloRating: users.eloRating,
      seasonPoints: users.seasonPoints,
      activeDroneSlots: users.activeDroneSlots,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) throw new ApiError('User not found', 404);

  const ownedDrones = await db
    .select()
    .from(drones)
    .where(eq(drones.userId, userId))
    .orderBy(desc(drones.eloRating));

  const droneIds = ownedDrones.map((d) => d.id);
  const recentRaces = droneIds.length
    ? await db
        .select()
        .from(races)
        .where(
          or(
            sql`${races.drone1Id} IN (${sql.join(droneIds.map((id) => sql`${id}`), sql`, `)})`,
            sql`${races.drone2Id} IN (${sql.join(droneIds.map((id) => sql`${id}`), sql`, `)})`,
          ),
        )
        .orderBy(desc(races.createdAt))
        .limit(20)
    : [];

  const ownedSkins = await db
    .select()
    .from(skins)
    .where(eq(skins.userId, userId))
    .orderBy(desc(skins.createdAt));

  return {
    ...user,
    drones: ownedDrones,
    recentRaces,
    skins: ownedSkins,
  };
}

/**
 * Quick stats card for the dashboard / sidebar.
 */
export async function getUserStats(userId) {
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      points: users.points,
      totalRaces: users.totalRaces,
      totalWins: users.totalWins,
      eloRating: users.eloRating,
      seasonPoints: users.seasonPoints,
      activeDroneSlots: users.activeDroneSlots,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user ?? null;
}
