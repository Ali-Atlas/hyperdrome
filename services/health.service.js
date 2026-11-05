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

/**
 * @param {string} check
 * @param {unknown} err
 */
function logFailure(check, err) {
  console.error({ scope: 'health', msg: `${check} check failed`, error: String(err) });
}

/**
 * Run the checks.
 * @param {{ db?: any, near?: () => import('@/lib/near').NearAdapter, now?: number }} [deps]
 *   `near` is a getter, so a broken adapter configuration is a failed RPC check
 * @returns {Promise<HealthReport>}
 */
export async function getHealth(deps = {}) {
  const db = deps.db ?? defaultDb;
  const near = deps.near ?? getNear;
  const now = deps.now ?? Date.now();
  /** @type {HealthReport} */
  const report = {
    ok: false,
    database: { ok: false },
    rpc: { ok: false },
    scheduler: { lastTickSlot: null, lastTickAgeSeconds: null },
    racingEnabled: null,
    checkedAt: new Date(now).toISOString(),
  };

  const database = (async () => {
    await db.execute(sql`select 1`);
    report.database.ok = true;
    /** @type {{ slot: number, startedAt: Date }[]} */
    const [tick] = await db.select().from(cronTicks).orderBy(desc(cronTicks.slot)).limit(1);
    if (tick) {
      report.scheduler = {
        lastTickSlot: Number(tick.slot),
        lastTickAgeSeconds: Math.max(0, Math.round((now - tick.startedAt.getTime()) / 1000)),
      };
    }
    report.racingEnabled = await isRacingEnabled({ db });
  })().catch((err) => logFailure('database', err));

  // The view goes to the RPC every time; `getConstants()` would answer from the process cache.
  const rpc = (async () => {
    report.rpc.ok = (await near().view('get_constants', {})) !== null;
  })().catch((err) => logFailure('rpc', err));

  await Promise.all([database, rpc]);
  report.ok = report.database.ok && report.rpc.ok;
  return report;
}
