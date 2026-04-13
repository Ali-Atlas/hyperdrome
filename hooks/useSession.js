'use client';

import {
  SessionProvider as NextAuthSessionProvider,
  useSession as useNextAuthSession,
  signIn,
  signOut,
} from 'next-auth/react';

/**
 * Re-exported SessionProvider so components can import it from one place.
 */
export const SessionProvider = NextAuthSessionProvider;

/**
 * App-level session hook. Returns `{ user, status, signIn, signOut }`.
 *
 * `user` is the shape we stash in the JWT callback (id, username, points)
 * with the base next-auth fields merged. `null` when unauthenticated.
 *
 * @returns {{
 *   user: (null | { id?: string, username?: string, points?: number, name?: string|null, email?: string|null, image?: string|null }),
 *   status: 'loading' | 'authenticated' | 'unauthenticated',
 *   signIn: typeof signIn,
 *   signOut: typeof signOut
 * }}
 */
export function useSession() {
  const { data, status } = useNextAuthSession();
  return {
    user: data?.user ?? null,
    status,
    signIn,
    signOut,
  };
}
