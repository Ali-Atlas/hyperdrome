import { handleMutation } from '@/lib/http/mutation.js';
import { droneIdParamSchema, equipBodySchema } from '@/lib/validators/gameplay.js';
import { equipItem } from '@/services/gameplay.service.js';

/**
 * POST /api/drones/[droneId]/equip (SPEC.md 4.4 `equip`): body `{ actionId, kind, item }`, a skin
 * or mod bound to this drone, or `item: null` to clear the slot.
 * @param {Request} request
 * @param {{ params: Promise<{ droneId: string }> }} context
 */
export async function POST(request, context) {
  const { droneId } = await context.params;
  return handleMutation(request, equipBodySchema, async ({ userId, body }) => {
    if (!droneIdParamSchema.safeParse(droneId).success) {
      return { status: 404, body: { error: 'Drone not found.' } };
    }
    return equipItem({ userId, droneId, ...body });
  });
}
