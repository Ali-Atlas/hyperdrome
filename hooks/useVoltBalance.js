'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useSession } from '@/hooks/useSession';

/**
 * Single source of truth for the user's VOLT balance across the app.
 *
 * Resolution order (first non-null wins):
 *
 *   1. `balanceOverride` - the most recent post-mutation balance the
 *      server returned (purchase, pack open, capsule open, stat allocate,
 *      NPC drone create). Set by listening on the global `volts:update`
 *      CustomEvent that those handlers dispatch. The override stays in
 *      effect for this hook's lifetime so a follow-up read-only render
 *      doesn't bounce back to the stale JWT mirror.
 *
 *   2. `onchainVolts` - the player wallet's on-chain ERC-20 balance
 *      (server-cached 30s via `/api/volt/balance`). Polls every 30s while
 *      a wallet is connected. Authoritative for wallet-bound users when
 *      no override has fired.
 *
 *   3. `user.points` - the JWT mirror. Only used when no wallet is
 *      connected (demo / email-auth users) and no override has fired.
 *
 * Why a hook (not module-scope state): every consumer subscribes
 * independently and gets a re-render on every update. NavShell, the
 * stat editor on the drone detail page, the marketplace buy modal, and
 * the drone manager all show the same number from the same logic, and
 * a `volts:update` dispatched anywhere updates them all in the same
 * React commit.
 *
 * @returns {number} the current VOLT balance to display (always an
 *   integer; on-chain wei is `Math.floor`'d).
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
        // permanent for demo accounts). Treat as null so the JWT mirror
        // wins instead of an authoritative-looking 0.
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

  return override ?? onchain ?? user?.points ?? 0;
}
