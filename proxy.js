import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

/**
 * Next.js 16 routing proxy (formerly `middleware.js` in prior versions).
 * Redirects unauthenticated requests for protected routes to /login.
 *
 * Exemptions handled inline:
 *   - /api/auth/*   → handled by NextAuth itself.
 *   - /drones/[id]  → public read-only drone profile (unauth viewers see
 *                     the profile; authed viewers may see management UI
 *                     if they own the drone).
 *
 * Everything listed in `config.matcher` below runs this proxy.
 */
export async function proxy(request) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/auth')) return NextResponse.next();

  // /drones/[droneId] — one path segment after /drones — is public.
  // /drones (the garage list) remains protected.
  if (/^\/drones\/[^/]+$/.test(pathname)) return NextResponse.next();

  const session = await auth();
  if (session?.user) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('callbackUrl', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/drones/:path*',
    '/races/:path*',
    '/leaderboard/:path*',
    '/marketplace/:path*',
    '/profile/:path*',
    '/admin/:path*',
  ],
};
