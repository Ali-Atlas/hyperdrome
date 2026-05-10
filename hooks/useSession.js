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
 * `user` is the shape we stash in the JWT callback (id, username, points,
 * totalRaces, walletAddress) with the base next-auth fields merged. `null`
 * when unauthenticated.
 *
 * `update()` triggers next-auth to re-fetch `/api/auth/session`, which
 * re-runs the JWT + session callbacks and refreshes the local in-memory
 * session. Wallet-auth components call this after a successful POST to
 * `/api/auth/wallet` so the freshly-set JWT cookie's contents become
 * visible without a full page reload.
 *
 * @returns {{
 *   user: (null | { id?: string, username?: string, points?: number, totalRaces?: number, walletAddress?: string|null, name?: string|null, email?: string|null, image?: string|null }),
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
