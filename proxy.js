import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { walletPageCsp } from '@/lib/wallet/csp.js';

/**
 * Next.js 16 routing proxy (formerly `middleware.js` in prior versions).
 *
 * Two responsibilities:
 *   1. Block /register and /signup IN PRODUCTION (no such flows; sign-in is /login with Google
 *      or Play Demo, SPEC.md 12). In local dev these pass through.
 *   2. Gate protected app routes. Unauthenticated requests redirect to /.
 *   3. /wallet: a per-request nonce and the page's Content-Security-Policy (SPEC.md 8), the one
 *      page that runs third-party wallet code.
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
    // Prod: bounce these routes to the landing page. Dev: pass through
    // so unauthenticated users are not redirected straight back to /.
    return IS_DEV ? NextResponse.next() : NextResponse.redirect(new URL('/', request.url));
  }

  if (pathname.startsWith('/api/auth')) return NextResponse.next();

  // /drones/[droneId] - one path segment after /drones - is public.
  // /drones (the garage list) remains protected.
  if (/^\/drones\/[^/]+$/.test(pathname)) return NextResponse.next();

  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL('/', request.url));

  if (pathname === '/wallet' || pathname.startsWith('/wallet/')) {
    const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
    const csp = walletPageCsp(nonce, { dev: IS_DEV });
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('Content-Security-Policy', csp);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('Content-Security-Policy', csp);
    return response;
  }
  return NextResponse.next();
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
    '/wallet/:path*',
    '/profile/:path*',
    '/admin/:path*',
  ],
};
