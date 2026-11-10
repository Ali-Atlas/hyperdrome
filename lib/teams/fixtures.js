/**
 * Test fixtures seeded through the team path (SPEC.md 10, 14). Never part of `TEAMS`: no `teams`
 * row, no active drone, no team phase, no health floor, and left out of the public lists
 * (`services/fixture-filter.js`), as bots are. Totals a reader can query from the contract still
 * count it (SPEC.md 8).
 */
import { teamEmail } from './roster.js';

/** @typedef {import('./roster.js').TeamDef} TeamDef */

/**
 * The rogue agent of the security demo (`npm run attack:demo`, docs/security-demo.md): a team
 * account whose play key the demo treats as stolen. Small caps, two level 20 drones with every
 * stat at 1 (room to spend Volts on stat points), one common mod bound to the first drone, and
 * 1 NEAR of gas, the default allowance of a player's play key.
 * @type {Readonly<TeamDef>}
 */
export const ROGUE_FIXTURE = Object.freeze({
  slug: 'testrogueagent',
  name: 'Test Rogue Agent',
  // Not used: the fixture's drones keep every stat at 1 and it has no `teams` row.
  weights: {
    speed: 12,
    turning: 11,
    acceleration: 11,
    durability: 11,
    nightVision: 11,
    batteryCapacity: 11,
    rainHandling: 11,
    windResistance: 11,
    consistency: 11,
  },
  skins: [],
  // Streamline Plate, bound and equipped on the first drone.
  mods: [{ template: 1, drone: 0 }],
  fixture: Object.freeze({
    perTxCap: 500,
    perDayCap: 1_000,
    startVolts: 5_000,
    droneLevels: [20, 20],
    gasYocto: 10n ** 24n,
  }),
});

/** @type {readonly TeamDef[]} */
export const FIXTURES = Object.freeze([ROGUE_FIXTURE]);

/** The fixtures' `users.email`, by which the public views leave them out. */
export const FIXTURE_EMAILS = Object.freeze(FIXTURES.map(teamEmail));
