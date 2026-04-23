import { withApiHandler, ok } from '@/lib/api/response.js';
import {
  getPlayerLeaderboard,
  getDroneLeaderboard,
  getSeasonInfo,
} from '@/services/leaderboard.service.js';

/** Parse a "lo-hi" bracket string into an inclusive [lo, hi] pair. */
function parseBracket(raw) {
  if (!raw) return null;
  const [loStr, hiStr] = String(raw).split('-');
  const lo = Number(loStr);
  const hi = Number(hiStr);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return [lo, hi];
}

export const GET = withApiHandler(
  async ({ request }) => {
    const url = new URL(request.url);
    const type = url.searchParams.get('type') ?? 'players';
    const sortBy = url.searchParams.get('sort_by') ?? 'elo';
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const includeBots = url.searchParams.get('include_bots') === 'true';
    const bracket = parseBracket(url.searchParams.get('bracket'));

    const items =
      type === 'drones'
        ? await getDroneLeaderboard(sortBy, limit, offset, {
            includeBots,
            bracket,
          })
        : await getPlayerLeaderboard(sortBy, limit, offset);
    const season = await getSeasonInfo();

    return ok({ type, sortBy, items, season });
  },
  { requireAuth: false },
);
