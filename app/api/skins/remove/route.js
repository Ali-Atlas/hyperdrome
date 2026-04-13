import { z } from 'zod';
import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import { removeSkin } from '@/services/skin.service.js';

const removeSchema = z.object({
  drone_id: z.uuid(),
});

export const POST = withApiHandler(async ({ session, request }) => {
  const body = await request.json().catch(() => ({}));
  const parsed = removeSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError('Invalid request body', 400, parsed.error.issues);
  }
  const drone = await removeSkin(session.user.id, parsed.data.drone_id);
  return ok(drone);
});
