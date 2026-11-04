import { handleMutation } from '@/lib/http/mutation.js';
import { listBodySchema } from '@/lib/validators/gameplay.js';
import { listToken } from '@/services/gameplay.service.js';

/**
 * POST /api/marketplace/list (SPEC.md 2.8, 4.4 `list`): body `{ actionId, token, price }`. The
 * token moves to escrow; a listed drone keeps racing.
 * @param {Request} request
 */
export async function POST(request) {
  return handleMutation(request, listBodySchema, ({ userId, body }) =>
    listToken({ userId, ...body })
  );
}
