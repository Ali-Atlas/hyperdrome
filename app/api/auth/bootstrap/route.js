import { checkOrigin } from '@/lib/http/origin.js';
import { requireSession } from '@/lib/http/session.js';
import { BootstrapPendingError, runBootstrap } from '@/services/bootstrap.service.js';

/**
 * One bootstrap step per call: the account (one transaction), the four mints, or the two binds;
 * each transaction waits for execution (SPEC.md 6).
 */
export const maxDuration = 60;

/**
 * POST /api/auth/bootstrap (SPEC.md 8, 12): makes the next step of the player's NEAR account and
 * starter kit setup, resuming where a previous call stopped. No body. 200 when done; 202 after a
 * step, while another request holds the bootstrap, or while an outcome is unknown (call again);
 * 502 when a chain step failed.
 * @param {Request} request
 */
export async function POST(request) {
  const bad = checkOrigin(request);
  if (bad) return bad;
  const who = await requireSession();
  if (who instanceof Response) return who;

  try {
    const status = await runBootstrap(who.userId);
    return Response.json(status, { status: status.state === 'done' ? 200 : 202 });
  } catch (err) {
    if (err instanceof BootstrapPendingError) {
      return Response.json({ state: 'none', pending: true }, { status: 202 });
    }
    console.error({ scope: 'bootstrap', msg: 'bootstrap step failed', userId: who.userId, err });
    const panic = /** @type {{ panic?: string }} */ (err).panic;
    return Response.json(
      {
        error: panic ? `Chain rejected the step: ${panic}` : 'Bootstrap step failed, retry shortly',
      },
      { status: 502 }
    );
  }
}
