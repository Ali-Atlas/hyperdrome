import { NextResponse } from 'next/server';
import { and, eq, inArray, like, notLike, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { auth, signIn } from '@/lib/auth';
import { seedDemoPlayer } from '@/scripts/seed-demo-player';

const { users } = schema;

/* -------------------------------------------------------------------------- */
/* Limits                                                                     */
/* -------------------------------------------------------------------------- */

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Hard ceiling on lifetime demo accounts in the DB. Counts every user
 * whose `name` starts with PILOT_ (pre-seeded D01..D10 + every fresh-
 * created PILOT_<4chars>, claimed or not). At cap, we block both the
 * claim and the fresh-create paths.
 */
const TOTAL_DEMO_CAP = 20;

async function getTotalDemoCount() {
  const [row] = await db
    .select({ count: sql`count(*)::int` })
    .from(users)
    .where(like(users.name, 'PILOT_%'));
  return row?.count ?? 0;
}

/** @type {Map<string, { count: number, resetAt: number }>} */
const ipBuckets = new Map();

function getClientIp(request) {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = ipBuckets.get(ip);
  if (!entry || now > entry.resetAt) {
    ipBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Pre-seeded pool                                                            */
/* -------------------------------------------------------------------------- */

/** Fixed pool of 10 pre-seeded demo emails. seed-production.js owns these. */
const PRE_SEEDED_EMAILS = Array.from({ length: 10 }, (_, i) => {
  const num = String(i + 1).padStart(2, '0');
  return `pilot_d${num}@demo.hyperdrome.gg`;
});

/** Re-key a claimed pre-seed so the original email no longer matches. */
function claimedEmailFor() {
  return `claimed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@demo.hyperdrome.gg`;
}

/* -------------------------------------------------------------------------- */
/* Fresh-create                                                               */
/* -------------------------------------------------------------------------- */

const SUFFIX_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomPilotName() {
  let suffix = '';
  for (let i = 0; i < 4; i += 1) {
    suffix += SUFFIX_CHARS[Math.floor(Math.random() * SUFFIX_CHARS.length)];
  }
  return `PILOT_${suffix}`;
}

/* -------------------------------------------------------------------------- */
/* POST                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/auth/demo
 *
 * Claim flow:
 *   1. Try to claim one of PILOT_D01..D10 if any remain unclaimed. The claim
 *      is an UPDATE that rewrites the email to `claimed_*` so a concurrent
 *      claimer can't grab the same row. Sign in, redirect. Instant - no
 *      seeding work, the account already has its drones, items, and races.
 *   2. If all 10 are claimed, fall back to the original fresh-create flow:
 *      mint a PILOT_<4chars> user, fire-and-forget `seedDemoPlayer` so the
 *      dashboard fills in over the next ~30s.
 *
 * Both paths produce visually identical accounts (same 8-drone roster,
 * cloned legendaries, real race history) - the difference is only that
 * the pre-seeded path is instant and the fallback ramps up while the
 * dashboard renders.
 */
export async function POST(request) {
  const session = await auth();
  if (session?.user?.name?.startsWith('PILOT_')) {
    return NextResponse.json({ redirectUrl: '/drones' });
  }

  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Demo limit reached. Try again later.' },
      { status: 429 },
    );
  }

  // Total cap across pre-seeded + dynamically created demo accounts.
  // Checked after the per-IP rate limit so an abusive IP doesn't burn a
  // count(*) query each request.
  if ((await getTotalDemoCount()) >= TOTAL_DEMO_CAP) {
    return NextResponse.json(
      { error: 'Demo is full. Check back later.' },
      { status: 429 },
    );
  }

  // 1. Try to claim a pre-seeded account.
  const claimable = await db
    .select()
    .from(users)
    .where(
      and(
        inArray(users.email, PRE_SEEDED_EMAILS),
        notLike(users.email, 'claimed_%'),
      ),
    )
    .orderBy(users.email)
    .limit(1);

  if (claimable.length > 0) {
    const target = claimable[0];
    const newEmail = claimedEmailFor();
    // Conditional UPDATE: only succeed if the email is still the original.
    // Guards against two concurrent demo presses claiming the same row.
    const claimed = await db
      .update(users)
      .set({ email: newEmail })
      .where(and(eq(users.id, target.id), eq(users.email, target.email)))
      .returning();

    if (claimed.length > 0) {
      try {
        await signIn('credentials', {
          userId: target.id,
          demoSecret: process.env.NEXTAUTH_SECRET,
          redirect: false,
        });
      } catch (err) {
        console.error('[demo] signIn (claim path) failed:', err);
        return NextResponse.json(
          { error: 'Demo claimed but sign-in failed. Try refreshing.' },
          { status: 500 },
        );
      }
      return NextResponse.json({ redirectUrl: '/drones' });
    }
    // The conditional update lost the race - fall through to fresh-create.
  }

  // 2. Fallback: fresh-create.
  let user = null;
  for (let attempt = 0; attempt < 5 && !user; attempt += 1) {
    const pilotName = randomPilotName();
    const email = `${pilotName.toLowerCase()}@demo.hyperdrome.gg`;
    try {
      const [created] = await db
        .insert(users)
        .values({
          name: pilotName,
          username: pilotName,
          email,
          emailVerified: new Date(),
        })
        .returning();
      user = created;
    } catch (err) {
      if (attempt === 4) {
        console.error('[demo] could not allocate pilot name:', err);
        return NextResponse.json(
          { error: 'Could not provision a demo account. Try again.' },
          { status: 500 },
        );
      }
    }
  }

  try {
    await signIn('credentials', {
      userId: user.id,
      demoSecret: process.env.NEXTAUTH_SECRET,
      redirect: false,
    });
  } catch (err) {
    console.error('[demo] signIn failed:', err);
    return NextResponse.json(
      { error: 'Demo provisioned but sign-in failed. Try refreshing.' },
      { status: 500 },
    );
  }

  // Fire-and-forget. Dashboard renders skeletons and picks up state as
  // the seed writes it. ~30s end-to-end on Neon HTTP.
  seedDemoPlayer(user.id).catch((err) => {
    console.error('[demo] background seedDemoPlayer failed:', err);
  });

  return NextResponse.json({ redirectUrl: '/drones' });
}
