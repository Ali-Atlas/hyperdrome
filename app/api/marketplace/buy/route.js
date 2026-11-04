import { handleMutation } from '@/lib/http/mutation.js';
import { tokenActionBodySchema } from '@/lib/validators/gameplay.js';
import { buyListing } from '@/services/gameplay.service.js';

/**
 * POST /api/marketplace/buy (SPEC.md 2.8, 4.4 `buy`): body `{ actionId, token }`. 90% of the
 * price goes to the seller and 10% to the treasury.
 * @param {Request} request
 */
export async function POST(request) {
  return handleMutation(request, tokenActionBodySchema, ({ userId, body }) =>
    buyListing({ userId, ...body })
  );
}
