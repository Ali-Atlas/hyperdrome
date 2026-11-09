import { handleMutation } from '@/lib/http/mutation.js';
import { linkBodySchema } from '@/lib/validators/wallet.js';
import { answerOrUnavailable, linkWallet } from '@/services/wallet.service.js';

/**
 * POST /api/wallet/link (SPEC.md 8): verifies the wallet's NEP-413 signature and challenge, then
 * sends `link_wallet`. 200 when linked, 202 `{ pending }` while the outcome is unknown.
 * @param {Request} request
 */
export async function POST(request) {
  return handleMutation(request, linkBodySchema, ({ userId, body }) =>
    answerOrUnavailable(() => linkWallet({ userId, body }))
  );
}
