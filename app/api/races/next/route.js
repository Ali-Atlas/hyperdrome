import { withApiHandler, ok } from '@/lib/api/response.js';
import { getNextRaceTime } from '@/services/race.service.js';

export const GET = withApiHandler(
  async () => {
    const next = await getNextRaceTime();
    return ok({ nextRaceAt: next.toISOString() });
  },
  { requireAuth: false },
);
