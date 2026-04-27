import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import { equipSkinSchema } from '@/lib/validators';
import { equipSkin } from '@/services/skin.service.js';

export const POST = withApiHandler(async ({ session, request }) => {
  const body = await request.json().catch(() => ({}));
  const parsed = equipSkinSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError('Invalid request body', 400, parsed.error.issues);
  }
  const result = await equipSkin(
    session.user.id,
    parsed.data.drone_id,
    parsed.data.skin_id,
  );
  return ok(result);
});
