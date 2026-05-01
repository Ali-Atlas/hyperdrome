import { withApiHandler, ok } from '@/lib/api/response.js';
import { getUpcomingRacesForUser } from '@/services/race.service.js';
import { getActiveDroneCount } from '@/services/drone.service.js';

/**
 * GET /api/races/upcoming
 *
 * Returns every PENDING race the authenticated user has a drone in,
 * sorted by scheduled_at ascending (next-to-execute first). Each race
 * carries full opponent stats so the player can study the matchup
 * during the strategy window.
 *
 * Also returns the user's active drone count. The footer's race-number
 * strip uses this to detect mid-creation polls (races.length <
 * activeDroneCount means the cron is still inserting pairs) and hold
 * the displayed list until the full set has landed - prevents the
 * "Races: 1" → "Races: 1 2 3" stutter as polls catch the partial state.
 *
 * Auth required. Empty array when the user has no upcoming races.
 */
export const GET = withApiHandler(async ({ session }) => {
  const [races, activeDroneCount] = await Promise.all([
    getUpcomingRacesForUser(session.user.id),
    getActiveDroneCount(session.user.id),
  ]);
  return ok({ races, activeDroneCount });
});
