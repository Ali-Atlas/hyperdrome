'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useSession } from '@/hooks/useSession';

/**
 * Single source of truth for the user's VOLT balance across the app.
 *
 * The hook splits cleanly into TWO disjoint paths driven by whether the
 * session user has a wallet bound (`user.walletAddress`):
 *
 *   - **Wallet user** (walletAddress is set): returns the on-chain
 *     ERC-20 balance ONLY. The DB-mirror `users.points` value is never
 *     read or returned. `volts:update` events (which carry DB-derived
 *     balances from server responses) are ignored entirely - they'd
 *     misrepresent reality for an account whose authoritative balance
 *     lives on-chain. Updates come exclusively from the 30s
 *     `/api/volt/balance` poll. While the first poll is in flight,
 *     `loading` is true so the UI can render '—' instead of a
 *     misleading 0.
 *
 *   - **Demo user** (no walletAddress): returns `users.points` (the
 *     server-side ledger), with `volts:update` overrides accepted as
 *     authoritative for as long as this hook lives (so a buy / pack /
 *     stat-allocate updates the displayed balance immediately without
 *     a fetch). On-chain is never queried for demo users.
 *
 * The discriminator is `user.walletAddress`, not wagmi's live
 * `isConnected`. Wagmi auto-reconnect can finish AFTER `useSession`
 * hydrates; keying off `isConnected` would briefly classify a
 * returning wallet user as "demo", show their stale JWT value, then
 * flip back. `walletAddress` is set in the JWT itself so it's
 * available the moment the session resolves.
 *
 * Why a hook (not module-scope state): every consumer subscribes
 * independently and gets a re-render on every update.
 *
 * @returns {{ balance: number, loading: boolean }}
 */
export function useVoltBalance() {
  const { user } = useSession();
  const { address, isConnected } = useAccount();

  const hasWallet = !!user?.walletAddress;

  // Override channel - DB-derived balance pushes from server responses
  // (marketplace buy, pack open, stat allocate, etc.). Demo users only:
  // for wallet users every dispatched balance is the stale JWT mirror,
  // not on-chain truth, so we never subscribe in that branch.
  const [override, setOverride] = useState(null);
  useEffect(() => {
    if (hasWallet) {
      // Drop any stale override that was set before walletAddress
      // appeared (e.g. demo → wallet upgrade in the same tab).
      setOverride(null);
      return undefined;
    }
    const handler = (e) => {
      const next = e?.detail?.balance;
      if (typeof next === 'number') setOverride(next);
    };
    window.addEventListener('volts:update', handler);
    return () => window.removeEventListener('volts:update', handler);
  }, [hasWallet]);

  // On-chain channel - only fetches when a wallet is connected. Demo
  // users skip this entirely (no fetch fires).
  const [onchain, setOnchain] = useState(null);
  useEffect(() => {
    if (!user || !isConnected || !address) {
      setOnchain(null);
      return undefined;
    }
    let cancelled = false;
    const url = `/api/volt/balance?address=${encodeURIComponent(address)}`;
    const fetchBalance = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          if (!cancelled) setOnchain(null);
          return;
        }
        const body = await res.json();
        const data = body?.data;
        // hasWallet=false is the route's "this address isn't bound to
        // the session user" signal. Leave onchain=null; the wallet-user
        // branch below will hold loading=true until binding completes.
        if (!data || data.hasWallet === false) {
          if (!cancelled) setOnchain(null);
          return;
        }
        const formatted = data.formatted;
        if (formatted == null) return;
        const asFloat = Number.parseFloat(formatted);
        if (!cancelled && Number.isFinite(asFloat)) {
          setOnchain(Math.floor(asFloat));
        }
      } catch {
        if (!cancelled) setOnchain(null);
      }
    };
    fetchBalance();
    const id = setInterval(fetchBalance, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [user, isConnected, address]);

  if (hasWallet) {
    return {
      balance: onchain ?? 0,
      loading: onchain == null,
    };
  }
  return {
    balance: override ?? user?.points ?? 0,
    loading: false,
  };
}
