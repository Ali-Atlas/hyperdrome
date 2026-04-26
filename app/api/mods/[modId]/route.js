import { z } from 'zod';
import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import { getModById } from '@/services/mod.service.js';

const uuidSchema = z.uuid();

export const GET = withApiHandler(
  async ({ params }) => {
    const parsed = uuidSchema.safeParse(params.modId);
    if (!parsed.success) {
      throw new ApiError('Mod not found', 404);
    }
    const mod = await getModById(parsed.data);
    return ok(mod);
  },
  { requireAuth: false },
);
