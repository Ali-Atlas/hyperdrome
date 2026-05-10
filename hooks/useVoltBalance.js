'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { useSession } from '@/hooks/useSession';

/**
 * sessionStorage key for the "awaiting starter VOLT mint" deadline. A
 * unix-ms timestamp; while `Date.now() < deadline` the hook treats a
 * zero on-chain balance as "still loading" rather than authoritative.
 * Survives navigation within the same tab so the user can click
 * around the dashboard during the bootstrap mint without losing the
 * loading state.
 */
const AWAITING_MINT_KEY = 'volts:awaiting-mint-until';
/** Default time the loading state holds open after a bootstrap kick-off. */
const AWAITING_MINT_DEFAULT_MS = 30_000;
/** While awaiting the mint, poll the on-chain balance this often. Once
 *  awaitingMint clears (mint landed or timeout), drop back to STEADY_MS. */
const AWAITING_POLL_MS = 3_000;
const STEADY_POLL_MS = 30_000;

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
 * **New-user bootstrap window**: when the wallet auth flow kicks off
 * `/api/auth/wallet/bootstrap`, it dispatches a `volts:awaiting-mint`
 * event so this hook holds `loading: true` (and shows '—') until the
 * starter VOLT mint actually lands on-chain - rather than briefly
 * flashing '0' between the first poll and the mint confirmation.
 * Auto-clears on the first non-zero balance or after a 30s ceiling.
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

  // True while the new-user bootstrap is in flight and the on-chain
  // VOLT mint hasn't landed yet. Drives both the loading flag (so a
  // freshly-polled 0 doesn't get displayed) AND the poll cadence (so
  // the hook hammers the chain every few seconds until the mint
  // settles, instead of waiting for the steady-state 30s tick).
  const [awaitingMint, setAwaitingMint] = useState(false);

  // The fetch function lives in a ref so the volts:update event handler
  // can call it imperatively without re-binding the listener whenever
  // the closure's dependencies change. Without the ref, every mount of
  // the on-chain effect would tear down and re-bind the global listener.
  const fetchOnchainRef = useRef(null);

  // Hydrate awaitingMint from sessionStorage on mount so a navigation
  // during the bootstrap (e.g. landing → /dashboard → /drones) doesn't
  // lose the loading state and flash '0' on the new page.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const raw = window.sessionStorage.getItem(AWAITING_MINT_KEY);
    if (!raw) return undefined;
    const deadline = Number(raw);
    if (!Number.isFinite(deadline) || deadline <= Date.now()) {
      window.sessionStorage.removeItem(AWAITING_MINT_KEY);
      return undefined;
    }
    setAwaitingMint(true);
    const t = setTimeout(() => {
      setAwaitingMint(false);
      window.sessionStorage.removeItem(AWAITING_MINT_KEY);
    }, deadline - Date.now());
    return () => clearTimeout(t);
  }, []);

  // External signal from the wallet-auth flow: a fresh user just
  // started bootstrap and is waiting for VOLT to be minted to their
  // address. Set the flag with the dispatcher's TTL (default 30s) and
  // a cleanup timer.
  useEffect(() => {
    function onAwaitingMint(e) {
      const ttlMs = Number(e?.detail?.ttlMs) || AWAITING_MINT_DEFAULT_MS;
      const deadline = Date.now() + ttlMs;
      setAwaitingMint(true);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(AWAITING_MINT_KEY, String(deadline));
      }
      // Single timeout per dispatch; if multiple dispatches happen
      // they'll each schedule their own clear and the latest wins.
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          const stored = window.sessionStorage.getItem(AWAITING_MINT_KEY);
          if (stored && Number(stored) <= Date.now()) {
            window.sessionStorage.removeItem(AWAITING_MINT_KEY);
          }
        }
        setAwaitingMint(false);
      }, ttlMs);
    }
    window.addEventListener('volts:awaiting-mint', onAwaitingMint);
    return () => window.removeEventListener('volts:awaiting-mint', onAwaitingMint);
  }, []);

  // Auto-clear the flag the moment we observe the mint landing
  // (non-zero balance). Without this, the loading dash sticks until
  // the 30s timeout even though the value is already correct.
  useEffect(() => {
    if (awaitingMint && typeof onchain === 'number' && onchain > 0) {
      setAwaitingMint(false);
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(AWAITING_MINT_KEY);
      }
    }
  }, [awaitingMint, onchain]);

  // On-chain fetch + poll. Only active for wallet users with a
  // connected wallet. Stores a "force fresh" variant in a ref so the
  // event handler can bypass the route's 30s cache after a known
  // mutation; the periodic poll normally uses the cache.
  // While `awaitingMint` is true the poll runs every 3s WITH fresh=1
  // so a 0 reading from the server cache (mint not yet visible)
  // doesn't lock in for 30s.
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
    fetchBalance(awaitingMint);
    const intervalMs = awaitingMint ? AWAITING_POLL_MS : STEADY_POLL_MS;
    const id = setInterval(() => fetchBalance(awaitingMint), intervalMs);
    return () => {
      cancelled = true;
      fetchOnchainRef.current = null;
      clearInterval(id);
    };
  }, [user, isConnected, address, awaitingMint]);

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
    const value = onchain ?? 0;
    return {
      balance: value,
      // Loading until: (a) the first fetch completes (onchain != null)
      // AND (b) we're not in the bootstrap-mint window with a still-zero
      // balance. (b) makes a fresh signup hold '—' instead of flashing
      // '0' between the first poll and the actual mint landing.
      loading: onchain == null || (awaitingMint && value === 0),
    };
  }
  return {
    balance: override ?? user?.points ?? 0,
    loading: false,
  };
}
