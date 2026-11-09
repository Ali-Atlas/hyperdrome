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
 * @typedef {{ settlementAllowanceNear: number | null, opsAllowanceNear: number | null, gameBalanceNear: number, gameAvailableNear: number }} FundingReport
 */

/**
 * @typedef {object} HealthReport
 * @property {boolean} ok the database, the RPC and the scheduler are all ok
 * @property {{ ok: boolean }} database
 * @property {{ ok: boolean }} rpc `get_constants` on the game contract
 * @property {{ ok: boolean, lastTickSlot: number | null, lastTickAgeSeconds: number | null, oldestCommittedAgeSeconds: number | null, funding: FundingReport | null }} scheduler the newest `cron_ticks` row and the oldest batch still `committed`, null when there is none or no database; what is left to pay for chain work, null when the RPC could not say; `ok` false without a database or under a funding floor
 * @property {boolean | null} racingEnabled `admin_config.racing_enabled`; null without a database
 * @property {string} checkedAt ISO time of this report
 */

/** How long one check may take before it counts as failed. */
const CHECK_TIMEOUT_MS = 8_000;

/** With racing on, a last tick older than this means the scheduler has stopped (a slot is 180 s). */
export const MAX_TICK_AGE_S = 300;

/** With racing on, a batch still `committed` after this has missed its settlement. */
export const MAX_COMMITTED_AGE_S = 600;

const ONE_NEAR = 1_000_000_000_000_000_000_000_000n;

/**
 * Funding floors in yoctoNEAR (SPEC.md 8): two days of measured burn. Settlement is 480 slots a day
 * at 0.002184 NEAR. The game account's figure adds 160 bytes of new storage per slot. The ops key
 * spends nothing per tick, so its floor is the gas of the demo signups still possible.
 */
export const MIN_SETTLEMENT_ALLOWANCE = (ONE_NEAR * 21n) / 10n;
export const MIN_OPS_ALLOWANCE = ONE_NEAR;
export const MIN_GAME_AVAILABLE = (ONE_NEAR * 37n) / 10n;

/**
 * yoctoNEAR as NEAR with 4 decimals, for the report.
 * @param {bigint} yocto
 */
function toNear(yocto) {
  return Number(yocto / 100_000_000_000_000_000_000n) / 10_000;
}

/**
 * True when every funding figure is at or above its floor; an unlimited key has no floor.
 * @param {import('@/lib/near/funding.js').FundingStatus} funding
 */
function funded({ settlementAllowance, opsAllowance, gameAvailable }) {
  return (
    (settlementAllowance === null || settlementAllowance >= MIN_SETTLEMENT_ALLOWANCE) &&
    (opsAllowance === null || opsAllowance >= MIN_OPS_ALLOWANCE) &&
    gameAvailable >= MIN_GAME_AVAILABLE
  );
}

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
      funding: null,
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
        funding: null,
      };
      report.racingEnabled = racingEnabled;
      report.database.ok = true;
    })(),
    timeoutMs
  ).catch((err) => logFailure('database', err));

  // The view goes to the RPC every time; `getConstants()` would answer from the process cache.
  /** @type {import('@/lib/near/funding.js').FundingStatus | null} */
  let funding = null;
  const rpc = within(
    (async () => {
      const adapter = near();
      const constants = await adapter.view('get_constants', {});
      funding = await adapter.fundingStatus();
      return constants !== null;
    })(),
    timeoutMs
  )
    .then((ok) => {
      report.rpc.ok = ok;
    })
    .catch((err) => logFailure('rpc', err));

  await Promise.all([database, rpc]);
  if (funding) {
    const status = /** @type {import('@/lib/near/funding.js').FundingStatus} */ (funding);
    report.scheduler.funding = {
      settlementAllowanceNear:
        status.settlementAllowance === null ? null : toNear(status.settlementAllowance),
      opsAllowanceNear: status.opsAllowance === null ? null : toNear(status.opsAllowance),
      gameBalanceNear: toNear(status.gameBalance),
      gameAvailableNear: toNear(status.gameAvailable),
    };
    report.scheduler.ok = report.scheduler.ok && funded(status);
  }
  report.ok = report.database.ok && report.rpc.ok && report.scheduler.ok;
  return report;
}
