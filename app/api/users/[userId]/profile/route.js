import { withApiHandler, ok } from '@/lib/api/response.js';
import { getUserProfile } from '@/services/user.service.js';

export const GET = withApiHandler(
  async ({ params }) => {
    const profile = await getUserProfile(params.userId);
    return ok(profile);
  },
  { requireAuth: false },
);
