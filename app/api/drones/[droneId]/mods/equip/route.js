import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import { equipModSchema } from '@/lib/validators';
import { equipMod } from '@/services/mod.service.js';

export const POST = withApiHandler(async ({ session, params, request }) => {
  const body = await request.json().catch(() => ({}));
  const parsed = equipModSchema.safeParse({
    drone_id: params.droneId,
    mod_id: body.mod_id,
  });
  if (!parsed.success) {
    throw new ApiError('Invalid request body', 400, parsed.error.issues);
  }
  const result = await equipMod(
    session.user.id,
    parsed.data.drone_id,
    parsed.data.mod_id,
  );
  return ok(result);
});
