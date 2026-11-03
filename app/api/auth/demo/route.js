import { auth, DEMO_NAME_PREFIX, signIn } from '@/lib/auth';
import { checkOrigin } from '@/lib/http/origin.js';
import {
  countDemoUsers,
  createDemoUser,
  demoAccountCap,
  recordDemoSignup,
} from '@/services/demo.service.js';

/** @param {Request} request */
function clientIp(request) {
  const fwd = request.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : (request.headers.get('x-real-ip') ?? 'unknown');
}

/**
 * POST /api/auth/demo: sign in a fresh `PILOT_` demo user (SPEC.md 12). Limits are in the database:
 * 5 per IP per hour and `DEMO_ACCOUNT_CAP` in total. The dashboard then runs
 * POST /api/auth/bootstrap, which creates the NEAR account and starter kit on chain.
 * @param {Request} request
 */
export async function POST(request) {
  const bad = checkOrigin(request);
  if (bad) return bad;
  if ((await auth())?.user?.name?.startsWith(DEMO_NAME_PREFIX)) {
    return Response.json({ redirectUrl: '/dashboard' });
  }

  try {
    if (!(await recordDemoSignup(clientIp(request)))) {
      return Response.json({ error: 'Demo limit reached. Try again later.' }, { status: 429 });
    }
    if ((await countDemoUsers()) >= demoAccountCap()) {
      return Response.json({ error: 'Demo is full. Check back later.' }, { status: 429 });
    }
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
