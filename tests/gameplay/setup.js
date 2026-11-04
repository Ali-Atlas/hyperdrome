/**
 * Shared setup for the gameplay service tests: a real Postgres with the committed migrations (CI's
 * service; locally any non-Neon DATABASE_URL, docs/runbooks/dev-setup.md) and the mock adapter.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createDb, isNeonUrl, schema } from '../../lib/db/index.js';
import { createMockNear } from '../../lib/near/mock.js';

const url = process.env.DATABASE_URL ?? '';
/** CI always has the test database; elsewhere the suites need one and never touch Neon. */
export const dbEnabled = Boolean(process.env.CI) || (url !== '' && !isNeonUrl(url));

/** Test-only sealing key for pack secrets; never a real secret. */
export const TEST_SECRET_KEY = '33'.repeat(32);

/** @returns {any} a Drizzle instance, or null when the suite is skipped */
export function testDb() {
  return dbEnabled ? createDb(url) : null;
}

/**
 * Minimal NEP-297 event, the shape `lib/near/events.js` produces.
 * @param {string} event
 * @param {unknown} data
 * @param {string} [standard]
 */
export const ev = (event, data, standard = 'hyperdrome') => ({
  standard,
  version: '1.0.0',
  event,
  data,
  receiptId: 'r',
});

/**
 * A bootstrapped player: a mock chain account and a `done` user row holding its play key.
 * @param {any} db
 * @param {ReturnType<typeof createMockNear>} near
 */
export async function newPlayer(db, near) {
  const slug = `t${randomBytes(6).toString('hex')}`;
  const account = await near.createPlayerAccount({ slug, isTeam: false });
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `${randomUUID()}@test.local`,
      username: slug.toUpperCase(),
      nearAccountId: account.accountId,
      playKeyEnc: account.playKeyEnc,
      keyVersion: 1,
      bootstrapState: 'done',
    })
    .returning();
  return { user, accountId: account.accountId };
}

/**
 * A cached drone row with a token id for `userId`.
 * @param {any} db
 * @param {string} userId
 */
export async function newDrone(db, userId) {
  const tokenId = `d:${randomBytes(5).readUIntBE(0, 5) + 1}`;
  const [drone] = await db
    .insert(schema.drones)
    .values({ userId, name: `T-${tokenId}`, tokenId })
    .returning();
  return drone;
}

export { createMockNear };
