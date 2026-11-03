import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

/**
 * Next.js 16 routing proxy (formerly `middleware.js` in prior versions).
 *
 * Two responsibilities:
 *   1. Block /register and /signup IN PRODUCTION (no such flows; sign-in is /login with Google
 *      or the magic link, SPEC.md 12). In local dev these pass through.
 *   2. Gate protected app routes. Unauthenticated requests redirect to /.
 *
 * Exemptions handled inline:
 *   - /api/auth/*   → handled by NextAuth itself.
 *   - /drones/[id]  → public read-only drone profile (unauth viewers see
 *                     the profile; authed viewers may see management UI
 *                     if they own the drone).
 *
 * Everything listed in `config.matcher` runs this proxy.
 */
const BLOCKED_AUTH_PATHS = new Set(['/register', '/signup']);
const IS_DEV = process.env.NODE_ENV === 'development';

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  if (BLOCKED_AUTH_PATHS.has(pathname)) {
    // Prod: bounce these routes to the landing page (PLAY DEMO is the
    // only entry). Dev: pass through so the magic-link form can render
    // for unauthenticated users - the auth gate below would otherwise
    // redirect them straight back to /, making the link feel dead.
    return IS_DEV ? NextResponse.next() : NextResponse.redirect(new URL('/', request.url));
  }

  if (pathname.startsWith('/api/auth')) return NextResponse.next();

  // /drones/[droneId] - one path segment after /drones - is public.
  // /drones (the garage list) remains protected.
  if (/^\/drones\/[^/]+$/.test(pathname)) return NextResponse.next();

  const session = await auth();
  if (session?.user) return NextResponse.next();

  return NextResponse.redirect(new URL('/', request.url));
}

export const config = {
  matcher: [
    '/register',
    '/signup',
    '/dashboard/:path*',
    '/drones/:path*',
    '/races/:path*',
    '/leaderboard/:path*',
    '/marketplace/:path*',
    '/profile/:path*',
    '/admin/:path*',
  ],
};
