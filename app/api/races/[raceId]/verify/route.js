import { withApiHandler, ok, fail } from '@/lib/api/response.js';
import { verifyRace } from '@/services/race-schedule.service.js';

/**
 * GET /api/races/[raceId]/verify (SPEC.md 8): replays the race on the server from its stored seed
 * and snapshots and answers `{ data: { match, raceId } }`; 404 for an unknown race, 409 while it
 * is not settled. Public.
 */
export const GET = withApiHandler(
  async ({ params }) => {
    const { status, body } = await verifyRace(params.raceId);
    return 'error' in body ? fail(body.error, status) : ok(body);
  },
  { requireAuth: false }
);
