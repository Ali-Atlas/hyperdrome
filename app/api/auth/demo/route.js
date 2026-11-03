import { auth, DEMO_NAME_PREFIX, signIn } from '@/lib/auth';
import { checkOrigin } from '@/lib/http/origin.js';
import { countDemoUsers, createDemoUser, DEMO_ACCOUNT_CAP } from '@/services/demo.service.js';

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** Per-instance IP buckets; the database cap below is the hard limit (SPEC.md 12, 14). */
/** @type {Map<string, { count: number, resetAt: number }>} */
const ipBuckets = new Map();

/** @param {Request} request */
function clientIp(request) {
  const fwd = request.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : (request.headers.get('x-real-ip') ?? 'unknown');
}

/** @param {string} ip */
function withinRateLimit(ip) {
  const now = Date.now();
  const entry = ipBuckets.get(ip);
  if (!entry || now > entry.resetAt) {
    ipBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT_MAX;
}

/**
 * POST /api/auth/demo: sign in a fresh `PILOT_` demo user (SPEC.md 12). The dashboard then runs
 * POST /api/auth/bootstrap, which creates the NEAR account and starter kit on chain.
 * @param {Request} request
 */
export async function POST(request) {
  const bad = checkOrigin(request);
  if (bad) return bad;
  if ((await auth())?.user?.name?.startsWith(DEMO_NAME_PREFIX)) {
    return Response.json({ redirectUrl: '/dashboard' });
  }
  if (!withinRateLimit(clientIp(request))) {
    return Response.json({ error: 'Demo limit reached. Try again later.' }, { status: 429 });
  }
  if ((await countDemoUsers()) >= DEMO_ACCOUNT_CAP) {
    return Response.json({ error: 'Demo is full. Check back later.' }, { status: 429 });
  }

  try {
    const user = await createDemoUser();
    await signIn('credentials', {
      userId: user.id,
      demoSecret: process.env.AUTH_SECRET,
      redirect: false,
    });
  } catch (err) {
    console.error({ scope: 'demo', msg: 'demo sign-in failed', err });
    return Response.json({ error: 'Could not start the demo. Try again.' }, { status: 500 });
  }
  return Response.json({ redirectUrl: '/dashboard' });
}
