import { timingSafeEqual } from 'node:crypto';
import { ok, fail } from '@/lib/api/response.js';
import { isRacingEnabled } from '@/services/race-schedule.service.js';
import { runTick } from '@/services/scheduler.service.js';

/** A tick settles up to a few chunks and commits one batch; each chain call waits up to 10 s. */
export const maxDuration = 60;

/**
 * Constant-time compare for the cron secret: the incoming value is a public header. A length
 * mismatch is false (constant against the known-length expected value).
 * @param {string | null} provided
 * @param {string} expected
 */
function safeEq(provided, expected) {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The scheduler tick (SPEC.md 3, 6): `Authorization: Bearer <CRON_SECRET>` (Vercel cron) or
 * `x-cron-secret: <CRON_SECRET>` (an external scheduler, `scripts/tick.mjs`). When
 * `admin_config.racing_enabled` is not `true` the tick still settles due batches and commits
 * nothing. Answers `{ data: { slot, claimed, settle, commit } }`; a slot already ticked answers
 * `claimed: false`.
 * @param {Request} request
 */
async function handler(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return fail('CRON_SECRET not configured', 500);
  const authHeader = request.headers.get('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  if (!safeEq(bearer, expected) && !safeEq(request.headers.get('x-cron-secret'), expected)) {
    return fail('Unauthorized', 401);
  }
  try {
    const enabled = await isRacingEnabled();
    const result = await runTick({ commit: enabled });
    return ok({ ...result, racingEnabled: enabled });
  } catch (err) {
    console.error({ scope: 'scheduler', msg: 'tick failed', error: String(err) });
    return fail('Tick failed', 500);
  }
}

// POST for schedulers and scripts; GET because Vercel cron invokes with GET.
export const POST = handler;
export const GET = handler;
