import { timingSafeEqual } from 'node:crypto';
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
import { db as maybeDb, schema } from '@/lib/db';

const { users, accounts, sessions, verificationTokens } = schema;
// DATABASE_URL is required wherever auth runs (the build sets a placeholder, docs/runbooks/dev-setup.md).
const db = /** @type {import('@/lib/db').Db} */ (maybeDb);

/** Prefix of demo users (`POST /api/auth/demo`); only they can use the demo provider. */
export const DEMO_NAME_PREFIX = 'PILOT_';

/**
 * Username from an email: the local part, uppercased, letters and digits only, with a 4-digit
 * suffix when taken. The NEAR slug is derived from it later (services/bootstrap.service.js).
 * @param {string} email
 * @returns {Promise<string>}
 */
async function generateUsername(email) {
  const base =
    (email.split('@')[0] || 'player')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 40) || 'PLAYER';
  const taken = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, base))
    .limit(1);
  if (taken.length === 0) return base;
  return `${base.slice(0, 35)}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * Constant-time check of the server-only demo secret.
 * @param {unknown} given
 */
function isDemoSecret(given) {
  const expected = process.env.AUTH_SECRET;
  if (typeof given !== 'string' || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  // Google reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET (Auth.js v5 env inference). No email sign-in
  // in the hackathon build (DECISIONS.md 3.13).
  providers: [
    Google,
    // Server-only demo sign-in, driven by POST /api/auth/demo with AUTH_SECRET; only PILOT_ users.
    Credentials({
      id: 'credentials',
      credentials: { userId: {}, demoSecret: {} },
      async authorize(credentials) {
        if (!isDemoSecret(credentials?.demoSecret)) return null;
        const userId = credentials?.userId;
        if (typeof userId !== 'string') return null;
        const [user] = await db
          .select({ id: users.id, email: users.email, name: users.name })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        return user?.name?.startsWith(DEMO_NAME_PREFIX) ? user : null;
      },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  trustHost: true,
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.userId = user.id;
      if (!token.userId) return token;
      // Mutable profile fields are re-read on every call so the nav balance stays current.
      const [row] = await db
        .select({
          username: users.username,
          points: users.points,
          totalRaces: users.totalRaces,
          nearAccountId: users.nearAccountId,
          bootstrapState: users.bootstrapState,
        })
        .from(users)
        .where(eq(users.id, /** @type {string} */ (token.userId)))
        .limit(1);
      if (!row) {
        // The cookie outlived its user row (a re-created dev database): read as signed out.
        for (const key of [
          'userId',
          'username',
          'points',
          'totalRaces',
          'nearAccountId',
          'bootstrapState',
          'name',
          'email',
        ])
          delete token[key];
        return token;
      }
      Object.assign(token, row);
      return token;
    },
    async session({ session, token }) {
      if (token?.userId) {
        Object.assign(session.user, {
          id: token.userId,
          username: token.username,
          points: token.points,
          totalRaces: token.totalRaces,
          nearAccountId: token.nearAccountId ?? null,
          bootstrapState: token.bootstrapState,
        });
      }
      return session;
    },
  },
  events: {
    // Only the username is set here. The NEAR account and starter kit are created on chain by
    // POST /api/auth/bootstrap (services/bootstrap.service.js).
    async createUser({ user }) {
      if (!user?.id || !user?.email) return;
      try {
        await db
          .update(users)
          .set({ username: await generateUsername(user.email) })
          .where(eq(users.id, user.id));
      } catch (err) {
        console.error({ scope: 'auth', msg: 'username init failed', userId: user.id, err });
      }
    },
  },
});
