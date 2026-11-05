/**
 * Shared setup for the team tests: a team seeded through the real seed service onto the fake
 * contract (tests/teams/fake-chain.js) and the test database, plus the helpers the suites share.
 * The team suites run in one file (tests/teams/teams.test.js), one after the other: the runner
 * acts on every team in the database, so two suites must never hold teams at the same time.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, inArray, or } from 'drizzle-orm';
import { schema } from '../../lib/db/index.js';
import { TIME_OF_DAY, WEATHER } from '../../lib/game-engine/race-simulator.js';
import { TEAMS } from '../../lib/teams/roster.js';
import { runPlayerAction } from '../../services/action.service.js';
import { applyEvents } from '../../services/chain-cache.service.js';
import { seedTeam } from '../../services/team-seed.service.js';
import { newPlayer } from '../gameplay/setup.js';

const { users, drones, mods, droneMods, marketplaceListings } = schema;

/** 1 NEAR in yoctoNEAR. */
export const NEAR = 10n ** 24n;

/**
 * Remove every team (and its listings) from the test database.
 * @param {any} db
 */
export async function wipeTeams(db) {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.isTeam, true));
  const ids = rows.map((/** @type {{ id: string }} */ r) => r.id);
  if (ids.length === 0) return;
  await db
    .delete(marketplaceListings)
    .where(
      or(inArray(marketplaceListings.sellerId, ids), inArray(marketplaceListings.buyerId, ids))
    );
  await db.delete(users).where(inArray(users.id, ids));
}

/**
 * A team definition with a unique slug: Vortex's weights, Ember on the level 4 drone, and on the
 * level 8 drone Aero Shell (bound first, so equipped) and Light Frame.
 * @param {Partial<import('../../lib/teams/roster.js').TeamDef>} [overrides]
 * @returns {import('../../lib/teams/roster.js').TeamDef}
 */
export function testTeam(overrides = {}) {
  const slug = `t${randomBytes(5).toString('hex')}`;
  return {
    slug,
    name: `Team ${slug}`,
    weights: TEAMS[0].weights,
    skins: [{ template: 4, drone: 0 }],
    mods: [
      { template: 11, drone: 2 },
      { template: 9, drone: 2 },
    ],
    ...overrides,
  };
}

/**
 * Seed `def` and return the team's user row and its drone rows by drone index.
 * @param {any} db
 * @param {ReturnType<typeof import('./fake-chain.js').createTeamChain>} chain
 * @param {import('../../lib/teams/roster.js').TeamDef} def
 */
export async function seedTestTeam(db, chain, def) {
  const { near } = chain;
  near.mock.setBalance(near.ownerId, 50n * NEAR);
  const seeded = await seedTeam(def, {
    db,
    near,
    fund: async ({ accountId, yocto }) => near.mock.setBalance(accountId, yocto + NEAR / 20n),
  });
  const [user] = await db.select().from(users).where(eq(users.nearAccountId, seeded.accountId));
  const rows = await db.select().from(drones).where(eq(drones.userId, user.id));
  rows.sort(
    (/** @type {{ level: number }} */ a, /** @type {{ level: number }} */ b) => a.level - b.level
  );
  return { user, accountId: seeded.accountId, drones: rows, report: seeded };
}

/**
 * A committed matchup for `token` against a bot, by condition names.
 * @param {string} token
 * @param {number} track 0-based track id (SPEC.md 2.9)
 * @param {string} [weather]
 * @param {string} [timeOfDay]
 */
export const matchup = (token, track, weather = 'clear', timeOfDay = 'day') => ({
  a: token,
  b: 'd:1',
  track,
  weather: WEATHER.indexOf(weather),
  tod: TIME_OF_DAY.indexOf(timeOfDay),
});

/**
 * The token of the mod equipped on a drone, from the cache.
 * @param {any} db
 * @param {string} droneId
 * @returns {Promise<string | null>}
 */
export async function equippedMod(db, droneId) {
  const [row] = await db
    .select({ token: mods.tokenId })
    .from(droneMods)
    .innerJoin(mods, eq(mods.id, droneMods.modId))
    .where(and(eq(droneMods.droneId, droneId), eq(droneMods.isEquipped, true)));
  return row?.token ?? null;
}

/**
 * A human player who mints a mod of `template` and lists it at `price`.
 * @param {any} db
 * @param {ReturnType<typeof import('./fake-chain.js').createTeamChain>} chain
 * @param {number} template
 * @param {number} price
 * @returns {Promise<string>} the listed token
 */
export async function listedByPlayer(db, chain, template, price) {
  const { near } = chain;
  const { user, accountId } = await newPlayer(db, near);
  const minted = await near.callAsOps('mint_item', {
    owner: accountId,
    kind: 'mod',
    template,
    placeholder_name: null,
  });
  await applyEvents(minted.events, { db, near });
  const token = /** @type {string} */ (minted.result);
  const listed = await runPlayerAction(
    {
      userId: user.id,
      actionId: randomUUID(),
      method: 'list',
      args: { token, price: String(price) },
      onApplied: (events) => applyEvents(events, { db, near }).then(() => ({})),
    },
    { db, near }
  );
  if (listed.status !== 200) throw new Error(`listing failed: ${JSON.stringify(listed.body)}`);
  return token;
}
