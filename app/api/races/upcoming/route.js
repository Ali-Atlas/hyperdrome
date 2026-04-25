import { withApiHandler, ok } from '@/lib/api/response.js';
import { getUpcomingRacesForUser } from '@/services/race.service.js';

/**
 * GET /api/races/upcoming
 *
 * Returns every PENDING race the authenticated user has a drone in,
 * sorted by scheduled_at ascending (next-to-execute first). Each race
 * carries full opponent stats so the player can study the matchup
 * during the strategy window.
 *
 * Auth required. Empty array when the user has no upcoming races.
 */
export const GET = withApiHandler(async ({ session }) => {
  const races = await getUpcomingRacesForUser(session.user.id);
  return ok({ races });
});
