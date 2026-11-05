/**
 * The health report behind `GET /api/health` (SPEC.md 8; ENGINEERING.md 5): the database answers,
 * the RPC answers a view of the game contract, when the scheduler last ticked, and whether racing
 * is on. Nothing in it is secret. A failed check is reported, never thrown.
 */
import { desc, sql } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { getNear } from '@/lib/near';
import { isRacingEnabled } from './race-schedule.service.js';

const { cronTicks } = schema;

/**
 * @typedef {object} HealthReport
 * @property {boolean} ok the database and the RPC both answered
 * @property {{ ok: boolean }} database
 * @property {{ ok: boolean }} rpc `get_constants` on the game contract
 * @property {{ lastTickSlot: number | null, lastTickAgeSeconds: number | null }} scheduler the newest `cron_ticks` row; null before the first tick or without a database
 * @property {boolean | null} racingEnabled `admin_config.racing_enabled`; null without a database
 * @property {string} checkedAt ISO time of this report
 */

/** How long one check may take before it counts as failed. */
const CHECK_TIMEOUT_MS = 8_000;

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
    scheduler: { lastTickSlot: null, lastTickAgeSeconds: null },
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
      const racingEnabled = await isRacingEnabled({ db });
      if (tick) {
        report.scheduler = {
          lastTickSlot: Number(tick.slot),
          lastTickAgeSeconds: Math.max(0, Math.round((now - tick.startedAt.getTime()) / 1000)),
        };
      }
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
  report.ok = report.database.ok && report.rpc.ok;
  return report;
}
