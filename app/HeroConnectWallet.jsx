'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useSession } from '@/hooks/useSession';
import {
  wasWalletAuthed,
  markWalletAuthed,
} from '@/lib/wallet-auth-cache';
import styles from './HeroConnectWallet.module.css';

// Module-scope guard mirroring NavShell's HeaderConnectWallet. Prevents
// concurrent /api/auth/wallet POSTs from a double-click, a Strict-Mode
// double-render in dev, or a re-render between hook firings.
const WALLET_AUTH_IN_FLIGHT = new Set();

/**
 * Top-right CONNECT WALLET CTA on the landing page. Standard web3 header
 * placement: floating fixed in the top-right corner so it stays reachable
 * while the user reads through the gameplay / economy / packs sections.
 *
 * Click flow:
 *   1. Wallet already attached AND session matches: nothing to do — the
 *      landing page's server redirect already sent authenticated users to
 *      /dashboard, but this is the belt for that suspenders.
 *   2. Wallet already attached, session does NOT match (or no session):
 *      the click goes straight to `POST /api/auth/wallet`.
 *   3. Wallet not attached: click opens the RainbowKit modal and the
 *      `pendingAuth` effect finishes the auth POST as soon as
 *      `useAccount` reports `isConnected`.
 *
 * On success, `router.push` to `data.redirectUrl` (skipped when already
 * on the target path) and `router.refresh` so the layout RSC reads the
 * just-set session cookie. No `window.location.href` - that would reset
 * the in-flight Set and re-trigger the auto-auth effect on the next
 * render of the landing page (it never normally re-renders post-auth
 * because LandingPage redirects authenticated users server-side, but we
 * are belt-and-suspenders).
 */
export default function HeroConnectWallet() {
  const [loading, setLoading] = useState(false);
  // Set when the user clicks while disconnected. RainbowKit opens, the user
  // picks a wallet, and the effect below detects the resulting `isConnected`
  // flip and continues into the auth POST. Cleared after one round-trip so a
  // later disconnect / reconnect on the landing page won't accidentally
  // re-fire the flow.
  const [pendingAuth, setPendingAuth] = useState(false);
  const [error, setError] = useState(null);
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { user, status, update } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  async function postWalletAuth(walletAddress) {
    if (loading) return;
    const lowerAddress = walletAddress.toLowerCase();
    // Already signed in as this exact wallet - the existing route would
    // also short-circuit, but skipping the round-trip is cheaper and
    // avoids resetting `loading` state for nothing.
    if (user?.walletAddress === lowerAddress) {
      const target = '/dashboard';
      if (pathname !== target) router.push(target);
      return;
    }
    // Persistent tab-lifetime cache: this address has already authed
    // successfully in this tab (via this component or
    // HeaderConnectWallet). Skip the POST.
    if (wasWalletAuthed(lowerAddress)) {
      const target = '/dashboard';
      if (pathname !== target) router.push(target);
      return;
    }
    if (WALLET_AUTH_IN_FLIGHT.has(lowerAddress)) return;
    WALLET_AUTH_IN_FLIGHT.add(lowerAddress);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not sign in with wallet. Try again.');
        return;
      }
      markWalletAuthed(lowerAddress);
      // Force next-auth to re-fetch /api/auth/session so the local
      // SessionProvider state picks up the new JWT cookie before we
      // navigate. Without this the destination page mounts under a
      // stale `useSession() = null` and would re-trigger the auto-auth
      // effect over there.
      await update();
      const target = data.redirectUrl || '/dashboard';
      if (pathname !== target) router.push(target);
      router.refresh();
    } catch {
      setError('Network error. Try again.');
    } finally {
      WALLET_AUTH_IN_FLIGHT.delete(lowerAddress);
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status === 'loading') return;
    if (!pendingAuth) return;
    if (!isConnected || !address) return;
    setPendingAuth(false);
    postWalletAuth(address);
    // postWalletAuth captures only stable refs; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAuth, isConnected, address, status]);

  function handleClick() {
    if (loading) return;
    if (isConnected && address) {
      postWalletAuth(address);
      return;
    }
    setPendingAuth(true);
    openConnectModal?.();
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={styles.button}
      >
        {loading
          ? 'Connecting...'
          : pendingAuth
            ? 'Open your wallet...'
            : 'Connect Wallet'}
      </button>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
