'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useSession } from '@/hooks/useSession';

/**
 * Single source of truth for the user's VOLT balance across the app.
 *
 * Resolution order:
 *
 *   1. `override` - the most recent post-mutation balance the server
 *      returned (purchase, pack open, capsule open, stat allocate, NPC
 *      drone create). Set by listening on the global `volts:update`
 *      CustomEvent that those handlers dispatch. Authoritative for any
 *      caller as soon as it fires.
 *
 *   2. `onchain` - the player wallet's on-chain ERC-20 balance
 *      (server-cached 30s via `/api/volt/balance`). Polls every 30s while
 *      a wallet is connected. Authoritative for wallet-bound users.
 *
 *   3. `user.points` - the JWT mirror. ONLY shown for demo / email-auth
 *      users (no wallet bound on the user record). For wallet-bound
 *      users this fallback is suppressed - we'd rather display nothing
 *      than briefly flash a stale on-chain balance from the JWT.
 *
 * `loading` is true when the user has a wallet bound (`user.walletAddress`)
 * but neither `override` nor `onchain` has resolved yet. UI consumers
 * (NavShell) render a skeleton/dash in that state so the user never sees
 * the JWT-mirror value flash before being replaced by the real on-chain
 * balance on refresh. We key the loading flag on `user.walletAddress`
 * (not `isConnected`) because wagmi auto-reconnect can finish AFTER
 * `useSession` hydrates - keying off the live wagmi flag would cause a
 * brief JWT flash → '—' → real-value sequence as wagmi races to catch up.
 *
 * Why a hook (not module-scope state): every consumer subscribes
 * independently and gets a re-render on every update. NavShell, the
 * stat editor on the drone detail page, the marketplace buy modal, and
 * the drone manager all show the same number from the same logic, and
 * a `volts:update` dispatched anywhere updates them all in the same
 * React commit.
 *
 * @returns {{ balance: number, loading: boolean }}
 */
export function useVoltBalance() {
  const { user } = useSession();
  const { address, isConnected } = useAccount();

  const [override, setOverride] = useState(null);
  useEffect(() => {
    const handler = (e) => {
      const next = e?.detail?.balance;
      if (typeof next === 'number') setOverride(next);
    };
    window.addEventListener('volts:update', handler);
    return () => window.removeEventListener('volts:update', handler);
  }, []);

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
        // hasWallet=false is the route's signal for "the user has no
        // server-bound walletAddress" (transient right after connect,
        // permanent for demo accounts). Leave onchain=null and let the
        // demo-user fallback below kick in.
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

  const hasWalletBound = !!user?.walletAddress;
  const loading = hasWalletBound && override == null && onchain == null;
  const balance =
    override ??
    onchain ??
    (hasWalletBound ? 0 : user?.points ?? 0);

  return { balance, loading };
}
