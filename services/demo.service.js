import { createHash, randomInt } from 'node:crypto';
import { and, eq, gt, like, sql } from 'drizzle-orm';
import { db as maybeDb, schema } from '@/lib/db';
import { DEMO_NAME_PREFIX } from '@/lib/auth';

const { users, demoSignups } = schema;
const db = /** @type {import('@/lib/db').Db} */ (maybeDb);

/** Default lifetime ceiling on demo accounts; each costs a NEAR account and a starter kit. */
export const DEFAULT_DEMO_ACCOUNT_CAP = 100;

/** Demo sign-ups allowed per IP per window, across every serverless instance. */
export const DEMO_PER_IP_LIMIT = 5;
export const DEMO_PER_IP_WINDOW_MS = 60 * 60 * 1000;

const SUFFIX_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * The lifetime demo cap: `DEMO_ACCOUNT_CAP` (SPEC.md 15) when it is a positive integer, else 100.
 * @param {string | undefined} [raw]
 */
export function demoAccountCap(raw = process.env.DEMO_ACCOUNT_CAP) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DEMO_ACCOUNT_CAP;
}

/** @returns {Promise<number>} demo users created so far */
export async function countDemoUsers() {
  const [row] = await db
    .select({ count: sql`count(*)::int` })
    .from(users)
    .where(like(users.name, `${DEMO_NAME_PREFIX}%`));
  return Number(row?.count ?? 0);
}

/**
 * Record a demo sign-up attempt for an IP and say whether it is within the per-IP limit. The row
 * is written first and the window counted after, so concurrent requests on any instance cannot all
 * slip under the limit. Only sha256(AUTH_SECRET ++ ip) is stored.
 * @param {string} ip
 * @returns {Promise<boolean>}
 */
export async function recordDemoSignup(ip) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set');
  const ipHash = createHash('sha256').update(secret).update(ip).digest('hex');
  await db.insert(demoSignups).values({ ipHash });
  const [row] = await db
    .select({ count: sql`count(*)::int` })
    .from(demoSignups)
    .where(
      and(
        eq(demoSignups.ipHash, ipHash),
        gt(demoSignups.createdAt, new Date(Date.now() - DEMO_PER_IP_WINDOW_MS))
      )
    );
  return Number(row?.count ?? 0) <= DEMO_PER_IP_LIMIT;
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
