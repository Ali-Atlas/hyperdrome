'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { useSession } from '@/hooks/useSession';

/**
 * Single source of truth for the user's VOLT balance across the app.
 *
 * Two disjoint paths driven by `user.walletAddress`:
 *
 *   - **Wallet user**: returns the on-chain ERC-20 balance ONLY. JWT
 *     mirror is never used. The hook polls `/api/volt/balance` every
 *     30s AND listens for `volts:update` events as a "refresh signal"
 *     - on every mutation event, the hook fires an immediate fresh
 *     fetch (the event payload's balance is ignored because it's the
 *     stale DB mirror, not on-chain truth).
 *
 *   - **Demo user**: returns `users.points` (DB ledger), with
 *     `volts:update` overrides used directly as the authoritative
 *     value (the server's response payload IS the truth for these
 *     accounts).
 *
 * Why the discriminator is `user.walletAddress` (not wagmi's
 * `isConnected`): wagmi auto-reconnect can finish AFTER `useSession`
 * hydrates; keying off `isConnected` would flap a returning wallet
 * user briefly through "demo" classification on first paint.
 *
 * @returns {{ balance: number, loading: boolean }}
 */
export function useVoltBalance() {
  const { user } = useSession();
  const { address, isConnected } = useAccount();

  const hasWallet = !!user?.walletAddress;

  // Demo-user override channel. For wallet users the listener below
  // discards the payload but uses the event as a refresh trigger.
  const [override, setOverride] = useState(null);

  // On-chain channel.
  const [onchain, setOnchain] = useState(null);

  // The fetch function lives in a ref so the volts:update event handler
  // can call it imperatively without re-binding the listener whenever
  // the closure's dependencies change. Without the ref, every mount of
  // the on-chain effect would tear down and re-bind the global listener.
  const fetchOnchainRef = useRef(null);

  // On-chain fetch + 30s poll. Only active for wallet users with a
  // connected wallet. Stores a "force fresh" variant in a ref so the
  // event handler can bypass the route's 30s cache after a known
  // mutation; the periodic poll uses the cache (saves RPC calls).
  useEffect(() => {
    if (!user || !isConnected || !address) {
      setOnchain(null);
      fetchOnchainRef.current = null;
      return undefined;
    }
    let cancelled = false;
    const baseUrl = `/api/volt/balance?address=${encodeURIComponent(address)}`;
    const fetchBalance = async (fresh = false) => {
      const url = fresh ? `${baseUrl}&fresh=1` : baseUrl;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) setOnchain(null);
          return;
        }
        const body = await res.json();
        const data = body?.data;
        // hasWallet=false is the route's "address isn't bound to the
        // session user" signal. Leave onchain=null; the wallet-user
        // branch holds loading=true until the binding completes.
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
    // Event-driven refresh always bypasses the 30s server cache.
    fetchOnchainRef.current = () => fetchBalance(true);
    fetchBalance(false);
    const id = setInterval(() => fetchBalance(false), 30_000);
    return () => {
      cancelled = true;
      fetchOnchainRef.current = null;
      clearInterval(id);
    };
  }, [user, isConnected, address]);

  // `volts:update` event - dispatched by every flow that mutates VOLT
  // (marketplace buy, pack open, capsule open, stat allocate, NPC drone
  // create). Wallet users use the event as a refresh signal and re-fetch
  // on-chain; demo users use the event payload as the new override.
  // Listener is always attached so we never miss an event during the
  // brief window where hasWallet flips.
  const handleVoltsUpdate = useCallback(
    (e) => {
      if (hasWallet) {
        // Discard the payload (it's the DB mirror, not on-chain truth)
        // and trigger an immediate on-chain refetch. After a write the
        // chain may need a beat to settle - the explicit fetch already
        // hits the server's /api/volt/balance which has its own RPC
        // call and 30s server cache. Cache hit is fine here because
        // the cache key is the address; a write affects the same key.
        // If staleness shows up, we'd add a no-cache hint to the API.
        fetchOnchainRef.current?.();
      } else {
        const next = e?.detail?.balance;
        if (typeof next === 'number') setOverride(next);
      }
    },
    [hasWallet],
  );

  useEffect(() => {
    window.addEventListener('volts:update', handleVoltsUpdate);
    return () => window.removeEventListener('volts:update', handleVoltsUpdate);
  }, [handleVoltsUpdate]);

  // Drop any stale override left over from a demo→wallet transition in
  // the same tab. Wallet users never read override, but resetting it
  // means a sign-out → sign-in-as-demo doesn't show a number from the
  // prior account.
  useEffect(() => {
    if (hasWallet) setOverride(null);
  }, [hasWallet]);

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
