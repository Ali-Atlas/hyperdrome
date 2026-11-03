import { checkOrigin } from '@/lib/http/origin.js';
import { requireSession } from '@/lib/http/session.js';
import { BootstrapPendingError, runBootstrap } from '@/services/bootstrap.service.js';

/** Account creation, four mints and two binds; each waits for execution (SPEC.md 6). */
export const maxDuration = 120;

/**
 * POST /api/auth/bootstrap (SPEC.md 8, 12): creates the player's NEAR account and starter kit, or
 * resumes where a previous call stopped. No body. 200 when done; 202 while another request holds
 * the bootstrap or an outcome is still unknown (call again); 502 when a chain step failed.
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
