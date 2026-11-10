/**
 * The per-UTC-day record of Volts minted and burned (SPEC.md 7, 8), from the contract's own nep141
 * events. Each applied outcome reaches this once, as it does the other caches (`applyEvents`, and
 * the ops `mint_volts` calls that do not go through it).
 */
import { sql } from 'drizzle-orm';
import { schema } from '@/lib/db';
import { utcDayKey, voltFlows } from '@/lib/live/summary.js';

const { voltDaily } = schema;

/**
 * Add one outcome's `ft_mint` and `ft_burn` totals to the day's row, every account counted, as
 * the contract's events report them (SPEC.md 8). A public statistic never stops the caches or a
 * settlement, so a failed write is logged and not thrown.
 * @param {import('@/lib/near').NearEvent[]} events
 * @param {any} db
 * @param {number} [nowMs]
 */
export async function recordVoltFlows(events, db, nowMs = Date.now()) {
  const { minted, burned } = voltFlows(events);
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
