import { withApiHandler, ok } from '@/lib/api/response.js';
import { getUserRank } from '@/services/leaderboard.service.js';
import { getUserStats } from '@/services/user.service.js';

export const GET = withApiHandler(async ({ session }) => {
  const [rank, stats] = await Promise.all([
    getUserRank(session.user.id),
    getUserStats(session.user.id),
  ]);
  return ok({ rank, ...stats });
});
