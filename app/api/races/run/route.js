import { runRaceCycle } from '@/services/race.service.js';
import { ok, fail } from '@/lib/api/response.js';

/**
 * Scheduled race cycle runner.
 * Protected by the CRON_SECRET header so only Vercel cron + our scripts can trigger it.
 *
 * Accepts either `Authorization: Bearer <secret>` (Vercel cron default)
 * or `x-cron-secret: <secret>` (our own scripts).
 */
async function handler(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return fail('CRON_SECRET not configured', 500);
  }
  const authHeader = request.headers.get('authorization');
  const custom = request.headers.get('x-cron-secret');
  const providedBearer =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : null;
  if (providedBearer !== expected && custom !== expected) {
    return fail('Unauthorized', 401);
  }

  try {
    const summary = await runRaceCycle();
    return ok(summary);
  } catch (err) {
    console.error('[api/races/run] race cycle failed:', err);
    return fail(err?.message || 'Race cycle failed', 500);
  }
}

// Both POST (manual trigger) and GET (Vercel cron invokes with GET by default)
export const POST = handler;
export const GET = handler;
