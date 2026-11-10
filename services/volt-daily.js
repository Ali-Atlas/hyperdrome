/**
 * The per-UTC-day record of Volts minted and burned (SPEC.md 7, 8), from the contract's own nep141
 * events. Each applied outcome reaches this once, as it does the other caches (`applyEvents`, and
 * the ops `mint_volts` calls that do not go through it).
 */
import { sql } from 'drizzle-orm';
import { schema } from '@/lib/db';
import { utcDayKey, voltFlows } from '@/lib/live/summary.js';
import { fixtureAccounts } from '@/lib/teams/fixtures.js';

const { voltDaily } = schema;

/**
 * Add one outcome's `ft_mint` and `ft_burn` totals to the day's row, leaving out the Volts of test
 * fixtures (`lib/teams/fixtures.js`, accounts under `NEAR_GAME_ID`). A public statistic never
 * stops the caches or a settlement, so a failed write is logged and not thrown.
 * @param {import('@/lib/near').NearEvent[]} events
 * @param {any} db
 * @param {number} [nowMs]
 * @param {Set<string>} [excluded] accounts not counted; the fixtures by default
 */
export async function recordVoltFlows(
  events,
  db,
  nowMs = Date.now(),
  excluded = fixtureAccounts(process.env.NEAR_GAME_ID)
) {
  const { minted, burned } = voltFlows(events, excluded);
  if (minted === 0 && burned === 0) return;
  const day = utcDayKey(nowMs);
  try {
    await db
      .insert(voltDaily)
      .values({ day, minted, burned })
      .onConflictDoUpdate({
        target: voltDaily.day,
        set: {
          minted: sql`${voltDaily.minted} + excluded.minted`,
          burned: sql`${voltDaily.burned} + excluded.burned`,
        },
      });
  } catch (err) {
    console.error({
      scope: 'live',
      msg: 'volt daily record failed',
      day,
      minted,
      burned,
      error: String(err),
    });
  }
}
