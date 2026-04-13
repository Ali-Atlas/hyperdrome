import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

/**
 * Next.js 16 routing proxy (formerly `middleware.js` in prior versions).
 * Redirects unauthenticated requests for protected routes to /login.
 *
 * Public routes: /, /login, /check-email, all /api/auth/*
 * Everything listed in `config.matcher` below runs this proxy.
 */
export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // Anything under /api/auth is handled by NextAuth itself
  if (pathname.startsWith('/api/auth')) return NextResponse.next();

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
