import { handleMutation } from '@/lib/http/mutation.js';
import { syncBodySchema } from '@/lib/validators/wallet.js';
import { syncWallet } from '@/services/wallet-sync.js';
import { answerOrUnavailable } from '@/services/wallet.service.js';

/**
 * POST /api/wallet/sync (SPEC.md 8): re-reads the player's tokens and Volts from chain into the
 * cache, after items are sent back from the wallet or withdrawn by the wallet directly.
 * @param {Request} request
 */
export async function POST(request) {
  return handleMutation(request, syncBodySchema, ({ userId }) =>
    answerOrUnavailable(() => syncWallet({ userId }))
  );
}
