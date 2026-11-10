/**
 * The AI racing teams (SPEC.md 2.10, 10): slug, name, persona weights over the 9 stats and the
 * starting kit `scripts/seed-teams.mjs` mints. Volt amounts (start, caps, reserve) are contract
 * constants and are read through `get_constants()`, never repeated here.
 */

/** @typedef {import('../game-engine/templates.js').StatKey} StatKey */

/**
 * @typedef {object} TeamDef
 * @property {string} slug the NEAR account is `<slug>.<game contract>`
 * @property {string} name shown on the leaderboard
 * @property {Record<StatKey, number>} weights persona weights, percent, sum 100
 * @property {{ template: number, drone: number }[]} skins skin template (SPEC.md 4.2) and the index of the drone it is bound to; any catalog skin but Ember
 * @property {{ template: number, drone: number }[]} mods mod template and drone index, in bind order (the first mod bound to a drone is equipped); one rare and two common, each with its bonus on one of the team's three heaviest stats
 * @property {FixtureTerms} [fixture] set only for a test fixture (`lib/teams/fixtures.js`)
 */

/**
 * A test fixture seeded through the team path (SPEC.md 10): a team account with its own caps and
 * kit. It is never in `TEAMS`, so it has no `teams` row, its drones stay inactive, the team phase
 * never runs it and the health check does not count it.
 * @typedef {object} FixtureTerms
 * @property {number} perTxCap on-chain cap on one Volt debit
 * @property {number} perDayCap on-chain cap on a day's Volt debits
 * @property {number} startVolts Volts the fixture is seeded with
 * @property {number[]} droneLevels one drone per entry, minted at that level with every stat at 1
 * @property {bigint} gasYocto the account's gas float and its play key's allowance, in yoctoNEAR
 */

/** Levels of a team's three drones, by drone index (SPEC.md 2.10). */
export const TEAM_DRONE_LEVELS = Object.freeze([4, 5, 8]);

/**
 * NEAR a team account holds for gas, and its play key's allowance, in yoctoNEAR (SPEC.md 2.10): a
 * team sends a transaction most ticks, so it gets 2 NEAR where a player has 0.05.
 */
export const TEAM_GAS_YOCTO = 2n * 10n ** 24n;

/** @type {readonly TeamDef[]} */
export const TEAMS = Object.freeze([
  {
    slug: 'vortex',
    name: 'Vortex Dynamics',
    weights: {
      speed: 30,
      turning: 10,
      acceleration: 20,
      durability: 6,
      nightVision: 4,
      batteryCapacity: 8,
      rainHandling: 4,
      windResistance: 12,
      consistency: 6,
    },
    // Cobalt; Dusk.
    skins: [
      { template: 2, drone: 1 },
      { template: 3, drone: 0 },
    ],
    // Aero Shell and Light Frame on the level 8 drone; Streamline Plate.
    mods: [
      { template: 11, drone: 2 },
      { template: 9, drone: 2 },
      { template: 1, drone: 1 },
    ],
  },
  {
    slug: 'nimbus',
    name: 'Nimbus Racing',
    weights: {
      speed: 12,
      turning: 12,
      acceleration: 8,
      durability: 6,
      nightVision: 22,
      batteryCapacity: 6,
      rainHandling: 22,
      windResistance: 6,
      consistency: 6,
    },
    // Frost; Bone.
    skins: [
      { template: 5, drone: 1 },
      { template: 1, drone: 0 },
    ],
    // Storm Plating and Night Lens on the level 8 drone; Rain Shield.
    mods: [
      { template: 13, drone: 2 },
      { template: 6, drone: 2 },
      { template: 7, drone: 1 },
    ],
  },
  {
    slug: 'hairpin',
    name: 'Hairpin Collective',
    weights: {
      speed: 8,
      turning: 30,
      acceleration: 14,
      durability: 22,
      nightVision: 4,
      batteryCapacity: 8,
      rainHandling: 4,
      windResistance: 4,
      consistency: 6,
    },
    // Rust; Venom.
    skins: [
      { template: 6, drone: 1 },
      { template: 8, drone: 0 },
    ],
    // Grip Coating and Grip Pads on the level 8 drone; Shock Absorber.
    mods: [
      { template: 12, drone: 2 },
      { template: 2, drone: 2 },
      { template: 4, drone: 1 },
    ],
  },
  {
    slug: 'static',
    name: 'Static Union',
    weights: {
      speed: 12,
      turning: 12,
      acceleration: 8,
      durability: 8,
      nightVision: 4,
      batteryCapacity: 24,
      rainHandling: 4,
      windResistance: 4,
      consistency: 24,
    },
    // Shadow; Bone.
    skins: [
      { template: 7, drone: 1 },
      { template: 1, drone: 0 },
    ],
    // Stabilizer Brace and Steady Module on the level 8 drone; Quick Charge.
    mods: [
      { template: 18, drone: 2 },
      { template: 5, drone: 2 },
      { template: 3, drone: 1 },
    ],
  },
]);

/**
 * The name of a team's drone by index: `VORTEX-V1`, `VORTEX-V2`, `VORTEX-V3`.
 * @param {TeamDef} team
 * @param {number} index 0-based
 * @returns {string}
 */
export function teamDroneName(team, index) {
  const tag = team.slug.toUpperCase();
  return `${tag}-${tag[0]}${index + 1}`;
}

/**
 * The team slug of a NEAR team account (`vortex.game.hyperdrome.testnet` -> `vortex`).
 * @param {string} accountId
 * @returns {string}
 */
export function teamSlugOf(accountId) {
  return accountId.split('.')[0];
}
