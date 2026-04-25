import { ApiError, withApiHandler, ok } from '@/lib/api/response.js';
import { getUpcomingRaceForDrone } from '@/services/race.service.js';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

const { drones } = schema;

/**
 * GET /api/races/upcoming/[droneId]
 *
 * Returns the single PENDING race the given drone is in, or null.
 * Auth required + ownership check: caller must own the drone.
 */
export const GET = withApiHandler(async ({ session, params }) => {
  const droneId = params?.droneId;
  if (!droneId) throw new ApiError('Missing drone id', 400);

  const [drone] = await db
    .select({ id: drones.id, userId: drones.userId })
    .from(drones)
    .where(eq(drones.id, droneId))
    .limit(1);
  if (!drone) throw new ApiError('Drone not found', 404);
  if (drone.userId !== session.user.id) {
    throw new ApiError('You do not own this drone', 403);
  }

  const race = await getUpcomingRaceForDrone(droneId, session.user.id);
  return ok({ race });
});
