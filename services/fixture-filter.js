/**
 * Test fixtures (`lib/teams/fixtures.js`, SPEC.md 10) are left out of the public lists, as bots
 * are: the leaderboards and rank, the marketplace feed, and batch candidates. Totals a reader can
 * query from the contract (supply, minted, burned, open listings, trades) are never filtered
 * (SPEC.md 8). A fixture is known by its `users.email`, which the seed sets and nothing changes.
 */
import { inArray, isNull, notInArray, or } from 'drizzle-orm';
import { schema } from '@/lib/db';
import { FIXTURE_EMAILS } from '@/lib/teams/fixtures.js';

const { users } = schema;

/**
 * Condition on `users`: the row is not a fixture.
 * @returns {import('drizzle-orm').SQL}
 */
export function notFixtureUser() {
  return /** @type {import('drizzle-orm').SQL} */ (
    or(isNull(users.email), notInArray(users.email, [...FIXTURE_EMAILS]))
  );
}

/**
 * Condition: `column`, a user id, is empty or not a fixture's.
 * @param {any} db
 * @param {import('drizzle-orm').Column} column
 * @returns {import('drizzle-orm').SQL}
 */
export function notFixtureOwned(db, column) {
  const fixtureIds = db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.email, [...FIXTURE_EMAILS]));
  return /** @type {import('drizzle-orm').SQL} */ (
    or(isNull(column), notInArray(column, fixtureIds))
  );
}
