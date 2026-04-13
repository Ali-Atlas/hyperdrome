import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import { toggleDroneSchema } from '@/lib/validators';
import { toggleActive } from '@/services/drone.service.js';

export const POST = withApiHandler(async ({ session, params, request }) => {
  const body = await request.json().catch(() => ({}));
  const parsed = toggleDroneSchema.safeParse({
    drone_id: params.droneId,
    active: body.active,
  });
  if (!parsed.success) {
    throw new ApiError('Invalid request body', 400, parsed.error.issues);
  }
  const updated = await toggleActive(
    params.droneId,
    session.user.id,
    parsed.data.active,
  );
  return ok(updated);
});
