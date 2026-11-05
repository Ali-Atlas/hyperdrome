import { withApiHandler, ok } from '@/lib/api/response.js';
import { getUpcomingRacesForUser } from '@/services/race-schedule.service.js';

/**
 * GET /api/races/upcoming (SPEC.md 8): the authenticated user's races in the committed batch,
 * each with both drones, the track, the conditions and `lockAt` (committed_at + 120 s), plus the
 * user's active drone count. Empty when nothing is committed.
 */
export const GET = withApiHandler(async ({ session }) => {
  const { races, activeDroneCount } = await getUpcomingRacesForUser(session.user.id);
  return ok({ races, activeDroneCount });
});
