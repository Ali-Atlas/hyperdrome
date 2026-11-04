import { handleMutation } from '@/lib/http/mutation.js';
import { droneIdParamSchema, toggleBodySchema } from '@/lib/validators/gameplay.js';
import { setDroneActive } from '@/services/gameplay.service.js';

/**
 * POST /api/drones/[droneId]/toggle (SPEC.md 8, database only): body `{ active }`. Activating
 * respects the active-slot limit (SPEC.md 2.2). Answers `{ data: drone }`.
 * @param {Request} request
 * @param {{ params: Promise<{ droneId: string }> }} context
 */
export async function POST(request, context) {
  const { droneId } = await context.params;
  return handleMutation(request, toggleBodySchema, async ({ userId, body }) => {
    if (!droneIdParamSchema.safeParse(droneId).success) {
      return { status: 404, body: { error: 'Drone not found.' } };
    }
    return setDroneActive({ userId, droneId, active: body.active });
  });
}
