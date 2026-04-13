import { z } from 'zod';
import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import { applySkin } from '@/services/skin.service.js';

const applySchema = z.object({
  skin_id: z.uuid(),
  drone_id: z.uuid(),
});

export const POST = withApiHandler(async ({ session, request }) => {
  const body = await request.json().catch(() => ({}));
  const parsed = applySchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError('Invalid request body', 400, parsed.error.issues);
  }
  const drone = await applySkin(
    session.user.id,
    parsed.data.skin_id,
    parsed.data.drone_id,
  );
  return ok(drone);
});
