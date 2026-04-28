import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { auth, signIn } from '@/lib/auth';
import { seedDemoPlayer } from '@/scripts/seed-demo-player';

const { users } = schema;

/* -------------------------------------------------------------------------- */
/* Rate limit                                                                 */
/* -------------------------------------------------------------------------- */

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * In-memory IP bucket. Resets per process; on Vercel each instance keeps
 * its own counter, so the effective limit is "5 per IP per instance per
 * hour." Acceptable for a demo gate; not a hard security boundary.
 * @type {Map<string, { count: number, resetAt: number }>}
 */
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
/* Pilot name                                                                 */
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
 * Provision a fresh PILOT_* account, seed it, and sign the caller in via
 * the server-only Credentials provider. The response carries a redirect
 * URL the client navigates to after the JWT cookie is set.
 */
export async function POST(request) {
  const session = await auth();
  if (session?.user?.name?.startsWith('PILOT_')) {
    return NextResponse.json({ redirectUrl: '/dashboard' });
  }

  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Demo limit reached, try again later.' },
      { status: 429 },
    );
  }

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
      // Unique-constraint collision on name/email/username - try a new
      // suffix. The 5-attempt loop covers this with margin (36^4 keys).
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

  // Fire-and-forget. The dashboard renders an empty/loading state and
  // picks up volts, drones, and race history as the seed writes them.
  // Captain accepted the tradeoff: 1-2s redirect beats holding the user
  // on the landing page for the full ~30s seed.
  seedDemoPlayer(user.id).catch((err) => {
    console.error('[demo] background seedDemoPlayer failed:', err);
  });

  return NextResponse.json({ redirectUrl: '/dashboard' });
}
