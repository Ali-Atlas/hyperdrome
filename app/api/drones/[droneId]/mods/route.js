import { z } from 'zod';
import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import { getDroneMods } from '@/services/mod.service.js';

const uuidSchema = z.uuid();

export const GET = withApiHandler(
  async ({ params }) => {
    const parsed = uuidSchema.safeParse(params.droneId);
    if (!parsed.success) {
      throw new ApiError('Drone not found', 404);
    }
    const items = await getDroneMods(parsed.data);
    return ok(items);
  },
  { requireAuth: false },
);
