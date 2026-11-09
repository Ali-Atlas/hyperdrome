import { requireSession } from '@/lib/http/session.js';
import { answerOrUnavailable, walletState } from '@/services/wallet.service.js';

/**
 * GET /api/wallet (SPEC.md 8): the player's link, Volts, drones and unbound items for the wallet
 * page.
 */
export async function GET() {
  const who = await requireSession();
  if (who instanceof Response) return who;
  const { status, body } = await answerOrUnavailable(() => walletState({ userId: who.userId }));
  return Response.json(body, { status });
}
