/**
 * The landing strip's arithmetic (SPEC.md 8 `GET /api/live`). Pure, so it is tested without a
 * database.
 */

/** @type {number} */
const DAY_MS = 86_400_000;

/**
 * The start of the UTC day containing `nowMs`, the day boundary the contract's team caps use
 * (SPEC.md 2.10).
 * @param {number} nowMs
 * @returns {Date}
 */
export function utcDayStart(nowMs) {
  return new Date(Math.floor(nowMs / DAY_MS) * DAY_MS);
}

/**
 * The `volt_daily.day` key of the UTC day containing `nowMs`.
 * @param {number} nowMs
 * @returns {string} `YYYY-MM-DD`
 */
export function utcDayKey(nowMs) {
  return utcDayStart(nowMs).toISOString().slice(0, 10);
}

/**
 * The Volts one outcome minted and burned, from its nep141 `ft_mint` and `ft_burn` events. Each
 * event's data is a list of entries with a U128 string amount; Volts have 0 decimals.
 * @param {import('@/lib/near').NearEvent[]} events
 * @returns {{ minted: number, burned: number }}
 */
export function voltFlows(events) {
  let minted = 0n;
  let burned = 0n;
  for (const e of events) {
    if (e.standard !== 'nep141' || (e.event !== 'ft_mint' && e.event !== 'ft_burn')) continue;
    const total = /** @type {{ amount: string }[]} */ (e.data).reduce(
      (sum, { amount }) => sum + BigInt(amount),
      0n
    );
    if (e.event === 'ft_mint') minted += total;
    else burned += total;
  }
  return { minted: Number(minted), burned: Number(burned) };
}

/**
 * A race's margin in milliseconds, from its two times in seconds; null while either is missing.
 * @param {string | number | null} time1
 * @param {string | number | null} time2
 * @returns {number | null}
 */
export function raceMarginMs(time1, time2) {
  if (time1 === null || time2 === null) return null;
  return Math.round(Math.abs(Number(time1) - Number(time2)) * 1000);
}
