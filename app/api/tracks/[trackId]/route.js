import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import {
  getTrackById,
  getTrackStats,
  getTopPerformersOnTrack,
  getRecentRacesOnTrack,
} from '@/services/track.service.js';

/**
 * Track detail + its aggregate stats, top-performer leaderboard, and
 * recent-race log. Public (no auth) - consistent with GET /api/tracks.
 */
export const GET = withApiHandler(
  async ({ params }) => {
    const { trackId } = params;
    const track = await getTrackById(trackId);
    if (!track) throw new ApiError('Track not found', 404);

    const [trackStats, topPerformers, recentRaces] = await Promise.all([
      getTrackStats(trackId),
      getTopPerformersOnTrack(trackId),
      getRecentRacesOnTrack(trackId),
    ]);

    return ok({ track, trackStats, topPerformers, recentRaces });
  },
  { requireAuth: false },
);
