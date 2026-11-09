/**
 * The landing strip's numbers (SPEC.md 8 `GET /api/live`), computed from row counts the service
 * reads. Pure, so the arithmetic is tested without a database.
 */

/** @typedef {{ kind: string, tier: number, count: number }} PackCount */

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
 * Volts minted and spent in a day, from the cached rows the service counted.
 * @param {object} day
 * @param {number} day.winnerVolts sum of `races.points_awarded`
 * @param {number} day.loserVolts sum of `races.loser_points_awarded`
 * @param {PackCount[]} day.packs packs and capsules opened on chain
 * @param {number} day.vendorDrones vendor drones bought
 * @param {number} day.fees sum of `marketplace_listings.platform_fee`
 * @param {number} day.trades listings sold
 * @param {object} prices from `get_constants().economy`
 * @param {{ id: number, skin_pack_price: string | number, mod_capsule_price: string | number }[]} prices.packs
 * @param {string | number} prices.vendor
 * @returns {{ voltsMinted: number, voltsBurned: number, voltsFees: number, trades: number }}
 */
export function summarizeDay(day, prices) {
  const packVolts = day.packs.reduce((sum, { kind, tier, count }) => {
    const pack = prices.packs.find((p) => p.id === tier);
    if (!pack) return sum;
    return sum + count * Number(kind === 'skin' ? pack.skin_pack_price : pack.mod_capsule_price);
  }, 0);
  return {
    voltsMinted: day.winnerVolts + day.loserVolts,
    voltsBurned: packVolts + day.vendorDrones * Number(prices.vendor),
    voltsFees: day.fees,
    trades: day.trades,
  };
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
