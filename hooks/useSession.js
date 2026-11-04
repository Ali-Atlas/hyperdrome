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
 * App-level session hook. Returns `{ user, status, signIn, signOut, update }`.
 *
 * `user` is the shape set in the JWT callback (id, username, points,
 * totalRaces, nearAccountId) with the base next-auth fields merged. `null`
 * when unauthenticated.
 *
 * `update()` re-fetches `/api/auth/session`, re-running the JWT and
 * session callbacks (the bootstrap panel calls it once the kit is minted).
 *
 * @returns {{
 *   user: (null | { id?: string, username?: string, points?: number, totalRaces?: number, nearAccountId?: string|null, bootstrapState?: string, name?: string|null, email?: string|null, image?: string|null }),
 *   status: 'loading' | 'authenticated' | 'unauthenticated',
 *   signIn: typeof signIn,
 *   signOut: typeof signOut,
 *   update: () => Promise<unknown>
 * }}
 */
export function useSession() {
  const { data, status, update } = useNextAuthSession();
  return {
    user: data?.user ?? null,
    status,
    signIn,
    signOut,
    update,
  };
}
