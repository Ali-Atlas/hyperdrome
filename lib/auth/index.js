import NextAuth from 'next-auth';
import Resend from 'next-auth/providers/resend';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';

const { users, accounts, sessions, verificationTokens, drones, droneOwnershipHistory } =
  schema;

/* -------------------------------------------------------------------------- */
/* Starter-drone bootstrap                                                    */
/* -------------------------------------------------------------------------- */

const DRONE_ADJECTIVES = [
  'SHADOW', 'NEON', 'CYBER', 'PHANTOM', 'PULSE',
  'ECHO', 'VOLT', 'STORM', 'GHOST', 'NOVA',
];
const DRONE_NOUNS = [
  'VIPER', 'HAWK', 'WOLF', 'BLADE', 'CLAW',
  'FANG', 'DART', 'BOLT', 'RAGE', 'FURY',
];

function randomDroneName() {
  const adj = DRONE_ADJECTIVES[Math.floor(Math.random() * DRONE_ADJECTIVES.length)];
  const noun = DRONE_NOUNS[Math.floor(Math.random() * DRONE_NOUNS.length)];
  return `${adj}-${noun}`;
}

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
 * @param {string} userId
 */
async function createStarterDrone(userId) {
  const name = randomDroneName();
  const [drone] = await db
    .insert(drones)
    .values({
      userId,
      name,
      level: 1,
      xp: 0,
      xpToNextLevel: 300,
      totalStatBudget: 29,
      unspentPoints: 20,
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
  ],
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    verifyRequest: '/check-email',
  },
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  callbacks: {
    async jwt({ token, user }) {
      // On sign-in, `user` is present - stash the app profile fields in the token
      if (user?.id) {
        const rows = await db
          .select({
            id: users.id,
            username: users.username,
            points: users.points,
          })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1);
        if (rows[0]) {
          token.userId = rows[0].id;
          token.username = rows[0].username;
          token.points = rows[0].points;
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
        };
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      try {
        if (!user?.id || !user?.email) return;
        const username = await generateUsername(user.email);
        await db.update(users).set({ username }).where(eq(users.id, user.id));
        await createStarterDrone(user.id);
      } catch (err) {
        console.error('[auth] createUser bootstrap failed:', err);
      }
    },
  },
});
