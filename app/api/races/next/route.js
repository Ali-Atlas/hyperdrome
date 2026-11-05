import { withApiHandler, ok } from '@/lib/api/response.js';
import { getNextRace } from '@/services/race-schedule.service.js';

/**
 * GET /api/races/next (SPEC.md 8): the start of the next batch slot from the clock
 * (`nextRaceAt`, `slot`) and whether racing is paused. Public; clients poll it (SPEC.md 9).
 */
export const GET = withApiHandler(async () => ok(await getNextRace()), { requireAuth: false });
