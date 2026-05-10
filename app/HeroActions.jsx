'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import styles from './HeroActions.module.css';

/**
 * Hero CTA cluster. Two paths into the game:
 *   - PLAY DEMO    (POST /api/auth/demo) - pre-seeded off-chain account.
 *   - CONNECT WALLET (POST /api/auth/wallet) - real wallet, on-chain assets.
 *
 * Both paths set a NextAuth session and redirect to /dashboard. The wallet
 * button opens RainbowKit when no wallet is connected; once an address is
 * available it hands off to /api/auth/wallet which provisions a starter
 * drone NFT + 1000 VOLT for first-time wallets and reuses the existing
 * record for return visits.
 *
 * Background audio for the hero is owned by `app/HeroAudio.jsx`
 * (landing page only); no audio runs inside the app shell.
 */
export default function HeroActions() {
  const [demoLoading, setDemoLoading] = useState(false);
  const [walletLoading, setWalletLoading] = useState(false);
  // Set when the user clicks Connect Wallet without a wallet attached.
  // RainbowKit opens, the user picks a wallet, and the effect below detects
  // the resulting `isConnected` flip and continues into the auth POST.
  const [pendingAuth, setPendingAuth] = useState(false);
  const [error, setError] = useState(null);
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  async function handleDemo() {
    if (demoLoading || walletLoading) return;
    setDemoLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/demo', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not start demo. Try again.');
        setDemoLoading(false);
        return;
      }
      window.location.href = data.redirectUrl || '/dashboard';
    } catch {
      setError('Network error. Try again.');
      setDemoLoading(false);
    }
  }

  async function postWalletAuth(walletAddress) {
    if (walletLoading) return;
    setWalletLoading(true);
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
        setWalletLoading(false);
        return;
      }
      window.location.href = data.redirectUrl || '/dashboard';
    } catch {
      setError('Network error. Try again.');
      setWalletLoading(false);
    }
  }

  // After the user opens RainbowKit and connects a wallet, finish the auth
  // POST automatically. Cleared after one round-trip so a later disconnect +
  // reconnect on the landing page doesn't accidentally re-fire the flow.
  useEffect(() => {
    if (!pendingAuth) return;
    if (!isConnected || !address) return;
    setPendingAuth(false);
    postWalletAuth(address);
    // postWalletAuth captures only stable refs; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAuth, isConnected, address]);

  function handleConnectWallet() {
    if (walletLoading || demoLoading) return;
    if (isConnected && address) {
      postWalletAuth(address);
      return;
    }
    setPendingAuth(true);
    openConnectModal?.();
  }

  return (
    <div className={styles.cluster}>
      <button
        type="button"
        onClick={handleDemo}
        disabled={demoLoading || walletLoading}
        className={styles.primary}
      >
        {demoLoading ? 'Loading...' : 'Play Demo'}
      </button>
      <button
        type="button"
        onClick={handleConnectWallet}
        disabled={walletLoading || demoLoading}
        className={styles.secondary}
      >
        {walletLoading
          ? 'Connecting...'
          : pendingAuth
            ? 'Open your wallet...'
            : 'Connect Wallet'}
      </button>
      {error && (
        <p role="alert" className={styles.errorText}>
          {error}
        </p>
      )}
    </div>
  );
}
