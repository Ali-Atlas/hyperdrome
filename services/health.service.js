/**
 * The health report behind `GET /api/health` (SPEC.md 8; ENGINEERING.md 5): the database answers,
 * the RPC answers a view of the game contract, the scheduler keeps ticking and settling, and whether
 * racing is on. Nothing in it is secret. A failed check is reported, never thrown.
 */
import { asc, desc, eq, sql } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { getNear } from '@/lib/near';
import { isRacingEnabled } from './race-schedule.service.js';

const { batches, cronTicks } = schema;

/**
 * @typedef {object} HealthReport
 * @property {boolean} ok the database, the RPC and the scheduler are all ok
 * @property {{ ok: boolean }} database
 * @property {{ ok: boolean }} rpc `get_constants` on the game contract
 * @property {{ ok: boolean, lastTickSlot: number | null, lastTickAgeSeconds: number | null, oldestCommittedAgeSeconds: number | null }} scheduler the newest `cron_ticks` row and the oldest batch still `committed`; null when there is none or no database, and `ok` false without a database
 * @property {boolean | null} racingEnabled `admin_config.racing_enabled`; null without a database
 * @property {string} checkedAt ISO time of this report
 */

/** How long one check may take before it counts as failed. */
const CHECK_TIMEOUT_MS = 8_000;

/** With racing on, a last tick older than this means the scheduler has stopped (a slot is 180 s). */
export const MAX_TICK_AGE_S = 300;

/** With racing on, a batch still `committed` after this has missed its settlement. */
export const MAX_COMMITTED_AGE_S = 600;

/**
 * Reject when `work` has not settled within `ms`.
 * @template T
 * @param {Promise<T>} work
 * @param {number} ms
 * @returns {Promise<T>}
 */
function within(work, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return /** @type {Promise<T>} */ (Promise.race([work, timeout])).finally(() =>
    clearTimeout(timer)
  );
}

/**
 * @param {string} check
 * @param {unknown} err
 */
function logFailure(check, err) {
  console.error({ scope: 'health', msg: `${check} check failed`, error: String(err) });
}

/**
 * The whole seconds from `time` to `now`, never negative.
 * @param {number} now
 * @param {Date} time
 */
function ageSeconds(now, time) {
  return Math.max(0, Math.round((now - time.getTime()) / 1000));
}

/**
 * Run the checks.
 * @param {{ db?: any, near?: () => import('@/lib/near').NearAdapter, now?: number, timeoutMs?: number }} [deps]
 *   `near` is a getter, so a broken adapter configuration is a failed RPC check; each check fails
 *   after `timeoutMs` (8 s), so a hung dependency still gets an answer
 * @returns {Promise<HealthReport>}
 */
export async function getHealth(deps = {}) {
  const db = deps.db ?? defaultDb;
  const near = deps.near ?? getNear;
  const now = deps.now ?? Date.now();
  const timeoutMs = deps.timeoutMs ?? CHECK_TIMEOUT_MS;
  /** @type {HealthReport} */
  const report = {
    ok: false,
    database: { ok: false },
    rpc: { ok: false },
    scheduler: {
      ok: false,
      lastTickSlot: null,
      lastTickAgeSeconds: null,
      oldestCommittedAgeSeconds: null,
    },
    racingEnabled: null,
    checkedAt: new Date(now).toISOString(),
  };

  // The database is ok only when every read the report needs answered: a database without the
  // migrations is not a healthy one.
  const database = within(
    (async () => {
      await db.execute(sql`select 1`);
      /** @type {{ slot: number, startedAt: Date }[]} */
      const [tick] = await db.select().from(cronTicks).orderBy(desc(cronTicks.slot)).limit(1);
      /** @type {{ committedAt: Date | null }[]} */
      const [oldest] = await db
        .select({ committedAt: batches.committedAt })
        .from(batches)
        .where(eq(batches.status, 'committed'))
        .orderBy(asc(batches.committedAt))
        .limit(1);
      const racingEnabled = await isRacingEnabled({ db });
      const lastTickAgeSeconds = tick ? ageSeconds(now, tick.startedAt) : null;
      const oldestCommittedAgeSeconds = oldest?.committedAt
        ? ageSeconds(now, oldest.committedAt)
        : null;
      const stale = lastTickAgeSeconds === null || lastTickAgeSeconds > MAX_TICK_AGE_S;
      const stuck =
        oldestCommittedAgeSeconds !== null && oldestCommittedAgeSeconds > MAX_COMMITTED_AGE_S;
      report.scheduler = {
        ok: !racingEnabled || (!stale && !stuck),
        lastTickSlot: tick ? Number(tick.slot) : null,
        lastTickAgeSeconds,
        oldestCommittedAgeSeconds,
      };
      report.racingEnabled = racingEnabled;
      report.database.ok = true;
    })(),
    timeoutMs
  ).catch((err) => logFailure('database', err));

  // The view goes to the RPC every time; `getConstants()` would answer from the process cache.
  const rpc = within((async () => (await near().view('get_constants', {})) !== null)(), timeoutMs)
    .then((ok) => {
      report.rpc.ok = ok;
    })
    .catch((err) => logFailure('rpc', err));

  await Promise.all([database, rpc]);
  report.ok = report.database.ok && report.rpc.ok && report.scheduler.ok;
  return report;
}
