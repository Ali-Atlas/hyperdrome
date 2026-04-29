import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { runRaceCycle } from '@/services/race.service.js';
import { ok, fail } from '@/lib/api/response.js';

const { adminConfig } = schema;

/**
 * Scheduled race cycle runner.
 * Protected by the CRON_SECRET header so only Vercel cron + our scripts can trigger it.
 *
 * Accepts either `Authorization: Bearer <secret>` (Vercel cron default)
 * or `x-cron-secret: <secret>` (our own scripts).
 *
 * Short-circuits when the `racing_enabled` admin_config row is not truthy -
 * the cron endpoint will return `{ message: 'Racing is paused' }` without
 * running any races. Flip the config flag via the admin panel to go live.
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

  // Master kill-switch - check the admin_config flag before doing anything
  try {
    const [flag] = await db
      .select()
      .from(adminConfig)
      .where(eq(adminConfig.key, 'racing_enabled'))
      .limit(1);
    const enabled = flag?.value === 'true';
    if (!enabled) {
      return ok({ message: 'Racing is paused', racingEnabled: false });
    }
  } catch (err) {
    console.error('[api/races/run] failed to check racing_enabled flag:', err);
    return fail('Failed to read racing flag', 500);
  }

  try {
    const summary = await runRaceCycle();
    return ok(summary);
  } catch (err) {
    console.error('[api/races/run] race cycle failed:', err);
    return fail('Race cycle failed', 500);
  }
}

// Both POST (manual trigger) and GET (Vercel cron invokes with GET by default)
export const POST = handler;
export const GET = handler;
