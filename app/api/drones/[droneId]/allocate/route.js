import { handleMutation } from '@/lib/http/mutation.js';
import { allocateBodySchema, droneIdParamSchema } from '@/lib/validators/gameplay.js';
import { allocateStats } from '@/services/gameplay.service.js';

/**
 * POST /api/drones/[droneId]/allocate (SPEC.md 4.4 `allocate_stats`): body `{ actionId, stats }`,
 * the drone's full new stat line in SPEC 2.1 order. The upgrade cost is burned from Volts.
 * @param {Request} request
 * @param {{ params: Promise<{ droneId: string }> }} context
 */
export async function POST(request, context) {
  const { droneId } = await context.params;
  return handleMutation(request, allocateBodySchema, async ({ userId, body }) => {
    if (!droneIdParamSchema.safeParse(droneId).success) {
      return { status: 404, body: { error: 'Drone not found.' } };
    }
    return allocateStats({ userId, droneId, ...body });
  });
}
