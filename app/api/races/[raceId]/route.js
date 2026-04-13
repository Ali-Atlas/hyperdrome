import { withApiHandler, ok } from '@/lib/api/response.js';
import { getRaceById } from '@/services/race.service.js';

export const GET = withApiHandler(
  async ({ params }) => {
    const race = await getRaceById(params.raceId);
    return ok(race);
  },
  { requireAuth: false },
);
