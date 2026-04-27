import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import { bindSkinSchema } from '@/lib/validators';
import { bindSkinToDrone } from '@/services/skin.service.js';

export const POST = withApiHandler(async ({ session, request }) => {
  const body = await request.json().catch(() => ({}));
  const parsed = bindSkinSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError('Invalid request body', 400, parsed.error.issues);
  }
  const result = await bindSkinToDrone(
    session.user.id,
    parsed.data.skin_id,
    parsed.data.drone_id,
  );
  return ok(result);
});
