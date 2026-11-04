import { handleMutation } from '@/lib/http/mutation.js';
import { tokenActionBodySchema } from '@/lib/validators/gameplay.js';
import { cancelListing } from '@/services/gameplay.service.js';

/**
 * POST /api/marketplace/cancel (SPEC.md 4.4 `cancel`): body `{ actionId, token }`. The seller's
 * token returns from escrow.
 * @param {Request} request
 */
export async function POST(request) {
  return handleMutation(request, tokenActionBodySchema, ({ userId, body }) =>
    cancelListing({ userId, ...body })
  );
}
