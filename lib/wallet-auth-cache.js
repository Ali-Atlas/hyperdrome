'use client';

/**
 * Tab-lifetime cache of lowercased wallet addresses for which
 * `POST /api/auth/wallet` has already succeeded. Both `HeaderConnectWallet`
 * (NavShell) and `HeroConnectWallet` (landing page) consult this Set
 * BEFORE firing the auth POST, so a wallet that's already been authed in
 * this tab doesn't generate a fresh sign-in round-trip on every page
 * navigation / remount / Strict-Mode double-effect.
 *
 * Why both an in-flight Set AND a done Set:
 *
 *   - in-flight (per-component) prevents the desktop + mobile NavShell
 *     instances (rendered concurrently in the same NavShell mount) from
 *     racing two simultaneous POSTs. It clears on completion.
 *   - done (shared across components, persistent within the tab) prevents
 *     a successful auth from being re-fired on the next page navigation
 *     - the session-match guard (`user.walletAddress === connected`)
 *     covers the same case once `useSession` updates locally, but there's
 *     a window after POST/router.push where the SessionProvider hasn't
 *     re-fetched yet and the match check fails.
 *
 * `clearWalletAuthCache()` is called from NavShell's sign-out handler so
 * a sign-out -> reconnect-same-wallet flow can re-auth without a tab
 * reload.
 */

const AUTHED_ADDRESSES = new Set();

/** True when this address has already authed successfully in this tab. */
export function wasWalletAuthed(address) {
  if (!address) return false;
  return AUTHED_ADDRESSES.has(address.toLowerCase());
}

/** Mark the address as authed. Called after a successful auth POST. */
export function markWalletAuthed(address) {
  if (!address) return;
  AUTHED_ADDRESSES.add(address.toLowerCase());
}

/**
 * Drop the cache so a subsequent reconnect of any address (typically the
 * same one the user just signed out of) can re-auth. Called from
 * `onSignOut` so the post-sign-out CONNECT WALLET press isn't blocked.
 */
export function clearWalletAuthCache() {
  AUTHED_ADDRESSES.clear();
}
