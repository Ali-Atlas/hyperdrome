import { randomInt } from 'node:crypto';
import { like, sql } from 'drizzle-orm';
import { db as maybeDb, schema } from '@/lib/db';
import { DEMO_NAME_PREFIX } from '@/lib/auth';

const { users } = schema;
const db = /** @type {import('@/lib/db').Db} */ (maybeDb);

/** Lifetime ceiling on demo accounts; each one costs a NEAR account and a starter kit. */
export const DEMO_ACCOUNT_CAP = 100;

const SUFFIX_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** @returns {Promise<number>} demo users created so far */
export async function countDemoUsers() {
  const [row] = await db
    .select({ count: sql`count(*)::int` })
    .from(users)
    .where(like(users.name, `${DEMO_NAME_PREFIX}%`));
  return Number(row?.count ?? 0);
}

/**
 * Create a `PILOT_XXXX` user (a few tries on a name collision). Its NEAR account and starter kit
 * come from POST /api/auth/bootstrap like any other user's.
 * @returns {Promise<{ id: string }>}
 */
export async function createDemoUser() {
  for (let attempt = 0; ; attempt += 1) {
    const suffix = Array.from({ length: 4 }, () => SUFFIX_CHARS[randomInt(SUFFIX_CHARS.length)]);
    const name = `${DEMO_NAME_PREFIX}${suffix.join('')}`;
    try {
      const [created] = await db
        .insert(users)
        .values({
          name,
          username: name,
          email: `${name.toLowerCase()}@demo.hyperdrome.gg`,
          emailVerified: new Date(),
        })
        .returning({ id: users.id });
      return created;
    } catch (err) {
      if (attempt >= 4) throw err;
    }
  }
}
