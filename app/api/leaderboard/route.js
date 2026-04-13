import { withApiHandler, ok } from '@/lib/api/response.js';
import {
  getPlayerLeaderboard,
  getDroneLeaderboard,
  getSeasonInfo,
} from '@/services/leaderboard.service.js';

export const GET = withApiHandler(
  async ({ request }) => {
    const url = new URL(request.url);
    const type = url.searchParams.get('type') ?? 'players';
    const sortBy = url.searchParams.get('sort_by') ?? 'elo';
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('offset') ?? 0);

    const items =
      type === 'drones'
        ? await getDroneLeaderboard(sortBy, limit, offset)
        : await getPlayerLeaderboard(sortBy, limit, offset);
    const season = await getSeasonInfo();

    return ok({ type, sortBy, items, season });
  },
  { requireAuth: false },
);
