import { withApiHandler, ok } from '@/lib/api/response.js';
import { getAllTracks } from '@/services/track.service.js';

/** Public list of all tracks - used by race results filter dropdown. */
export const GET = withApiHandler(
  async () => {
    const tracks = await getAllTracks();
    return ok(tracks);
  },
  { requireAuth: false },
);
