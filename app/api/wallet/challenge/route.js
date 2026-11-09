import { handleMutation } from '@/lib/http/mutation.js';
import { challengeBodySchema } from '@/lib/validators/wallet.js';
import { createChallenge } from '@/services/wallet.service.js';

/**
 * POST /api/wallet/challenge (SPEC.md 8): a single-use nonce to sign with the wallet. The recipient
 * is the host this request was addressed to, the same host the Origin check allows.
 * @param {Request} request
 */
export async function POST(request) {
  const host = new URL(request.url).host;
  return handleMutation(request, challengeBodySchema, ({ userId }) =>
    createChallenge({ userId, host })
  );
}
