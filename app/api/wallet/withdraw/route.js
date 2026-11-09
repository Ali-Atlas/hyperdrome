import { handleMutation } from '@/lib/http/mutation.js';
import { withdrawBodySchema } from '@/lib/validators/wallet.js';
import { answerOrUnavailable, withdrawToWallet } from '@/services/wallet.service.js';

/**
 * POST /api/wallet/withdraw (SPEC.md 8): `{ actionId, tokens, volts }`. Sends `withdraw` with the
 * ops key under the action path's guarantees; the destination is always the linked wallet.
 * @param {Request} request
 */
export async function POST(request) {
  return handleMutation(request, withdrawBodySchema, ({ userId, body }) =>
    answerOrUnavailable(() => withdrawToWallet({ userId, ...body }))
  );
}
