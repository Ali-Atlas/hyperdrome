import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import { allocateStatsSchema } from '@/lib/validators';
import { allocateStats } from '@/services/drone.service.js';

export const POST = withApiHandler(async ({ session, params, request }) => {
  const body = await request.json().catch(() => ({}));
  const parsed = allocateStatsSchema.safeParse({
    drone_id: params.droneId,
    stat_changes: body.stat_changes ?? body.statChanges ?? {},
  });
  if (!parsed.success) {
    throw new ApiError('Invalid request body', 400, parsed.error.issues);
  }
  const updated = await allocateStats(
    params.droneId,
    session.user.id,
    parsed.data.stat_changes,
  );
  return ok(updated);
});
