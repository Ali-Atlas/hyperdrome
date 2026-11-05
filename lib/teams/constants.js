/**
 * The contract constants the AI teams use (SPEC.md 2.7, 2.10), read from `get_constants()` so the
 * app never repeats them.
 */

/**
 * @typedef {object} TeamEconomy
 * @property {number} startVolts Volts a team is seeded with
 * @property {number} perTxCap cap on one Volt debit
 * @property {number} perDayCap cap on a day's Volt debits
 * @property {number} reserve Volts a team never spends below
 * @property {number[]} droneLevels levels of a team's drones
 * @property {{ starter: number, premium: number }} capsulePrices mod capsule prices by tier
 */

/**
 * @param {unknown} constants the `get_constants()` result
 * @returns {TeamEconomy}
 */
export function teamEconomy(constants) {
  const economy = /** @type {any} */ (constants)?.economy;
  if (!economy?.packs) throw new Error('get_constants() has no economy section');
  /** @param {number} tier pack tier id (0 starter, 1 premium) */
  const capsule = (tier) => {
    const pack = economy.packs.find((/** @type {{ id: number }} */ p) => p.id === tier);
    if (!pack) throw new Error(`get_constants() has no pack tier ${tier}`);
    return Number(pack.mod_capsule_price);
  };
  return {
    startVolts: Number(economy.team_start_volts),
    perTxCap: Number(economy.team_per_tx_cap),
    perDayCap: Number(economy.team_per_day_cap),
    reserve: Number(economy.team_reserve),
    droneLevels: /** @type {number[]} */ (economy.team_drone_levels),
    capsulePrices: { starter: capsule(0), premium: capsule(1) },
  };
}
