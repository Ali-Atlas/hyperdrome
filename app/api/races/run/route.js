import { timingSafeEqual } from 'node:crypto';
import { after } from 'next/server';
import { ok, fail } from '@/lib/api/response.js';
import { isRacingEnabled } from '@/services/race-schedule.service.js';
import { beginTick, runTick } from '@/services/scheduler.service.js';

/**
 * A tick settles up to a few chunks, commits one batch and lets each AI team take one action; each
 * chain call waits up to 10 s, and no team starts later than 40 s into the tick. The phases of a
 * background tick run in `after()`, inside this same limit.
 */
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
 * Claim the slot, answer at once and run the phases after the response. A phase that throws is
 * logged here, since the answer has already left; the next tick resumes the batch.
 * @param {boolean} enabled `admin_config.racing_enabled`
 */
async function backgroundTick(enabled) {
  const { slot, claimed, run } = await beginTick({ commit: enabled });
  if (!run) return ok({ slot, claimed, racingEnabled: enabled });
  after(async () => {
    try {
      await run();
    } catch (err) {
      console.error({
        scope: 'scheduler',
        msg: 'background tick failed',
        slot,
        error: String(err),
      });
    }
  });
  return ok({ slot, claimed, background: true, racingEnabled: enabled }, 202);
}

/**
 * The scheduler tick (SPEC.md 3, 6, 8): `Authorization: Bearer <CRON_SECRET>` (Vercel cron) or
 * `x-cron-secret: <CRON_SECRET>` (an external scheduler, `scripts/tick.mjs`). When
 * `admin_config.racing_enabled` is not `true` the tick still settles due batches and commits
 * nothing. Answers `{ data: { slot, claimed, settle, commit, teams } }`; a slot already ticked
 * answers `claimed: false`. With `?mode=background` a claimed slot answers 202 before the phases
 * run, for a scheduler whose request timeout is shorter than a tick.
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
    if (new URL(request.url).searchParams.get('mode') === 'background') {
      return await backgroundTick(enabled);
    }
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
