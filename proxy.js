import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

/**
 * Next.js 16 routing proxy (formerly `middleware.js` in prior versions).
 *
 * Two responsibilities:
 *   1. Block /login, /register, /signup. Registration is disabled - PLAY
 *      DEMO is the only entry point. Any visit to those paths bounces to
 *      the landing page.
 *   2. Gate protected app routes. Unauthenticated requests redirect to /.
 *      (Pre-Apr 2026 this redirected to /login; with login blocked, the
 *      landing page is now the canonical fallback so we avoid a redirect
 *      chain.)
 *
 * Exemptions handled inline:
 *   - /api/auth/*   → handled by NextAuth itself.
 *   - /drones/[id]  → public read-only drone profile (unauth viewers see
 *                     the profile; authed viewers may see management UI
 *                     if they own the drone).
 *
 * Everything listed in `config.matcher` runs this proxy.
 */
const BLOCKED_AUTH_PATHS = new Set(['/login', '/register', '/signup']);

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  if (BLOCKED_AUTH_PATHS.has(pathname)) {
    return NextResponse.redirect(new URL('/', request.url));
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
    '/login',
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
