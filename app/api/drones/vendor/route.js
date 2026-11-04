import { handleMutation } from '@/lib/http/mutation.js';
import { vendorBodySchema } from '@/lib/validators/gameplay.js';
import { buyVendorDrone } from '@/services/gameplay.service.js';

/**
 * POST /api/drones/vendor (SPEC.md 2.1, 4.4 `vendor_buy_drone`): body `{ actionId }`. A level 1
 * drone for 3,500 Volts, with a common skin and a common mod bound.
 * @param {Request} request
 */
export async function POST(request) {
  return handleMutation(request, vendorBodySchema, ({ userId, body }) =>
    buyVendorDrone({ userId, actionId: body.actionId })
  );
}
