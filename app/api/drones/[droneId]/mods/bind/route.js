import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import { bindModSchema } from '@/lib/validators';
import { bindMod } from '@/services/mod.service.js';

export const POST = withApiHandler(async ({ session, params, request }) => {
  const body = await request.json().catch(() => ({}));
  const parsed = bindModSchema.safeParse({
    drone_id: params.droneId,
    mod_id: body.mod_id,
  });
  if (!parsed.success) {
    throw new ApiError('Invalid request body', 400, parsed.error.issues);
  }
  const result = await bindMod(
    session.user.id,
    parsed.data.mod_id,
    parsed.data.drone_id,
  );
  return ok(result);
});
