import { handleMutation } from '@/lib/http/mutation.js';
import { bindBodySchema, droneIdParamSchema } from '@/lib/validators/gameplay.js';
import { bindItem } from '@/services/gameplay.service.js';

/**
 * POST /api/drones/[droneId]/bind (SPEC.md 4.4 `bind`): body `{ actionId, item }`, an unbound
 * skin or mod the player owns. Binding is permanent and equips an empty slot.
 * @param {Request} request
 * @param {{ params: Promise<{ droneId: string }> }} context
 */
export async function POST(request, context) {
  const { droneId } = await context.params;
  return handleMutation(request, bindBodySchema, async ({ userId, body }) => {
    if (!droneIdParamSchema.safeParse(droneId).success) {
      return { status: 404, body: { error: 'Drone not found.' } };
    }
    return bindItem({ userId, droneId, ...body });
  });
}
