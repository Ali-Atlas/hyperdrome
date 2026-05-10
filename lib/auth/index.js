import NextAuth from 'next-auth';
import Resend from 'next-auth/providers/resend';
import Credentials from 'next-auth/providers/credentials';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { and, eq, isNull, like } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { generateUniqueDroneName } from '@/lib/game-engine/drone-names.js';

const {
  users,
  accounts,
  sessions,
  verificationTokens,
  drones,
  droneOwnershipHistory,
  skins,
  mods,
} = schema;

const STARTING_VOLTS = 500;

/* -------------------------------------------------------------------------- */
/* Starter-drone bootstrap                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Generate a candidate username from an email address, stripped and uppercased.
 * Collisions get a random 4-digit suffix.
 * @param {string} email
 * @returns {Promise<string>}
 */
async function generateUsername(email) {
  const base =
    (email.split('@')[0] || 'player')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 40) || 'PLAYER';

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, base))
    .limit(1);
  if (existing.length === 0) return base;

  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${base.slice(0, 35)}-${suffix}`;
}

/**
 * Create the starter drone for a brand-new user.
 * Called from `events.createUser` - best-effort; any failure is logged but
 * does not abort sign-up because the Neon HTTP driver has no transactions.
 *
 * Every stat starts at 1 (sum 9, TSB 29 -> 20 points of headroom). Equal
 * baseline for every new player, with an immediate reason to engage with
 * the stat-allocation system on day one.
 * @param {string} userId
 */
async function createStarterDrone(userId) {
  const name = await generateUniqueDroneName(db, drones);
  const [drone] = await db
    .insert(drones)
    .values({
      userId,
      name,
      level: 1,
      xp: 0,
      xpToNextLevel: 300,
      totalStatBudget: 29,
      speed: 1,
      turning: 1,
      acceleration: 1,
      durability: 1,
      nightVision: 1,
      batteryCapacity: 1,
      rainHandling: 1,
      windResistance: 1,
      consistency: 1,
      active: true,
      imageUrl: '/drones/default.png',
      isBot: false,
    })
    .returning();

  await db.insert(droneOwnershipHistory).values({
    droneId: drone.id,
    ownerUserId: userId,
    transactionType: 'creation',
  });
}

/**
 * The canonical starter skin is "Ember" - common tier, image-backed.
 * Locked to a specific name (rather than random) so every new player
 * gets the same identifiable starter skin. If no Ember row exists in
 * the unowned vault (somebody's seed data drifted, or the vault was
 * exhausted), fall back to a random unowned image-backed common - we
 * still want the player to leave signup with SOMETHING in their
 * locker, but the operator should notice the mismatch via the warning
 * log below.
 */
const STARTER_SKIN_NAME = 'Ember';

export async function cloneStarterSkin(userId) {
  // Strict: Ember from the unowned vault, image-backed.
  const [ember] = await db
    .select()
    .from(skins)
    .where(
      and(
        eq(skins.name, STARTER_SKIN_NAME),
        eq(skins.rarity, 'common'),
        isNull(skins.userId),
        like(skins.imageUrl, '/skins/%.webp'),
      ),
    )
    .limit(1);

  let template = ember;
  if (!template) {
    console.warn(
      `[auth] starter skin '${STARTER_SKIN_NAME}' not found in unowned vault; falling back to a random common`,
    );
    const candidates = await db
      .select()
      .from(skins)
      .where(
        and(
          eq(skins.rarity, 'common'),
          isNull(skins.userId),
          like(skins.imageUrl, '/skins/%.webp'),
        ),
      );
    if (candidates.length === 0) return null;
    template = candidates[Math.floor(Math.random() * candidates.length)];
  }

  const [row] = await db
    .insert(skins)
    .values({
      userId,
      name: template.name,
      rarity: template.rarity,
      imageUrl: template.imageUrl,
      description: template.description,
    })
    .returning();
  return row;
}

/**
 * Pick one common mod from the vault (userId IS NULL) and INSERT a copy
 * owned by `userId`. Mirrors cloneStarterSkin; mods don't need an image
 * filter because every mod is rendered from text fields.
 *
 * Returns the new row, or null when no common mod is stocked.
 */
export async function cloneStarterMod(userId) {
  const candidates = await db
    .select()
    .from(mods)
    .where(and(eq(mods.rarity, 'common'), isNull(mods.userId)));
  if (candidates.length === 0) return null;
  const template = candidates[Math.floor(Math.random() * candidates.length)];
  const [row] = await db
    .insert(mods)
    .values({
      userId,
      name: template.name,
      rarity: template.rarity,
      description: template.description,
      statBonusType: template.statBonusType,
      statBonusValue: template.statBonusValue,
      statPenaltyType: template.statPenaltyType,
      statPenaltyValue: template.statPenaltyValue,
      specialAbility: template.specialAbility,
      imageUrl: template.imageUrl,
    })
    .returning();
  return row;
}

/* -------------------------------------------------------------------------- */
/* NextAuth config                                                            */
/* -------------------------------------------------------------------------- */

const adapter = DrizzleAdapter(db, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: 'Drone Manager <onboarding@resend.dev>',
    }),
    /**
     * Server-only demo sign-in. Invoked from `app/api/auth/demo/route.js`
     * after a PILOT_* user is created and seeded. The `demoSecret` is
     * compared against `NEXTAUTH_SECRET` so this provider can never be
     * driven by an external client - the secret never leaves the server.
     * Authorize also rejects any user whose name doesn't start with
     * `PILOT_`, locking this path to demo accounts only.
     */
    Credentials({
      credentials: {
        userId: {},
        demoSecret: {},
      },
      async authorize(credentials) {
        const userId = credentials?.userId;
        const demoSecret = credentials?.demoSecret;
        if (!userId || !demoSecret) return null;
        if (demoSecret !== process.env.NEXTAUTH_SECRET) return null;

        const [user] = await db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
          })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!user) return null;
        if (!user.name?.startsWith('PILOT_')) return null;
        return user;
      },
    }),
    /**
     * Server-only wallet sign-in. Invoked from `app/api/auth/wallet/route.js`
     * after a wallet user is found (or freshly created). Mirrors the demo
     * provider's secret-comparison guard so this path can never be driven
     * by an external client. Authorize requires the user to already have a
     * `walletAddress` set, so it can only sign in wallet-bound rows.
     */
    Credentials({
      id: 'wallet',
      credentials: {
        userId: {},
        walletSecret: {},
      },
      async authorize(credentials) {
        const userId = credentials?.userId;
        const walletSecret = credentials?.walletSecret;
        if (!userId || !walletSecret) return null;
        if (walletSecret !== process.env.NEXTAUTH_SECRET) return null;

        const [user] = await db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            walletAddress: users.walletAddress,
          })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!user) return null;
        if (!user.walletAddress) return null;
        return user;
      },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    verifyRequest: '/check-email',
    error: '/auth-error',
  },
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  callbacks: {
    async jwt({ token, user }) {
      // On first sign-in, `user` is present - stash the canonical id so
      // subsequent calls have something to look up by.
      if (user?.id) {
        token.userId = user.id;
      }
      // Refresh mutable fields (points, username, totalRaces) from the DB
      // on every call so the balance shown in the nav and the milestone
      // bar in the recruit modal stay current without a sign-out round-trip.
      // totalRaces is the canonical user-level race count (sum-over-drones
      // diverges if a drone is sold).
      if (token.userId) {
        const rows = await db
          .select({
            username: users.username,
            points: users.points,
            totalRaces: users.totalRaces,
            walletAddress: users.walletAddress,
          })
          .from(users)
          .where(eq(users.id, token.userId))
          .limit(1);
        if (rows[0]) {
          token.username = rows[0].username;
          token.points = rows[0].points;
          token.totalRaces = rows[0].totalRaces;
          // Lowercased so the client-side compare against
          // `useAccount().address?.toLowerCase()` matches without a
          // re-checksum step. Null when the row has no bound wallet (a
          // demo / email-auth account).
          token.walletAddress = rows[0].walletAddress
            ? rows[0].walletAddress.toLowerCase()
            : null;
        } else {
          // userId points to a row that no longer exists (typically a
          // dev-time DB re-seed under a still-valid cookie). Clear the
          // identifying fields so withApiHandler reads the session as
          // unauthenticated (401) and /api/auth/demo's PILOT_* short-
          // circuit doesn't fire on a dead user. signIn on the next
          // login/Play-Demo press overwrites the JWT cookie.
          token.userId = undefined;
          token.username = undefined;
          token.points = undefined;
          token.totalRaces = undefined;
          token.walletAddress = undefined;
          token.name = undefined;
          token.email = undefined;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.userId) {
        session.user = {
          ...session.user,
          id: token.userId,
          username: token.username,
          points: token.points,
          totalRaces: token.totalRaces,
          walletAddress: token.walletAddress ?? null,
        };
      }
      return session;
    },
  },
  events: {
    /**
     * Bootstrap a fresh user with a username, starting volts, a randomized
     * starter drone, and one common skin + one common mod cloned (unbound)
     * from the vault. Each step is wrapped individually so a single
     * failure (e.g. empty mod vault on a fresh DB) doesn't deny the user
     * the rest of their bootstrap.
     */
    async createUser({ user }) {
      if (!user?.id || !user?.email) return;

      try {
        const username = await generateUsername(user.email);
        await db
          .update(users)
          .set({ username, points: STARTING_VOLTS })
          .where(eq(users.id, user.id));
      } catch (err) {
        console.error('[auth] username + volts init failed:', err);
      }

      try {
        await createStarterDrone(user.id);
      } catch (err) {
        console.error('[auth] starter drone creation failed:', err);
      }

      try {
        await cloneStarterSkin(user.id);
      } catch (err) {
        console.error('[auth] starter skin clone failed:', err);
      }

      try {
        await cloneStarterMod(user.id);
      } catch (err) {
        console.error('[auth] starter mod clone failed:', err);
      }
    },
  },
});
