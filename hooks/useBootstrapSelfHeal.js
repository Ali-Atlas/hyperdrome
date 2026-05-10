'use client';

import { useEffect } from 'react';
import { useSession } from '@/hooks/useSession';

/**
 * sessionStorage key shared with the connect-wallet flow
 * (HeroConnectWallet, HeaderConnectWallet). When that flow fires
 * `/api/auth/wallet/bootstrap` after signup, it sets this key so this
 * self-heal hook doesn't fire a redundant second call on the dashboard
 * mount that follows. When the self-heal hook fires its own bootstrap
 * (because the connect flow's call was lost - e.g. tab closed mid-mint),
 * it sets the same key so subsequent navigations don't re-fire.
 *
 * Tab-scoped on purpose: a fresh tab should re-attempt the self-heal in
 * case the previous tab's bootstrap really did get dropped.
 */
const BOOTSTRAP_FIRED_KEY = 'bootstrap-fired';

/**
 * Dashboard self-heal for the wallet bootstrap. Mounts via NavShell on
 * every authenticated page, so any time a wallet user lands in the app
 * we make sure their on-chain provisioning has been kicked off at least
 * once this tab session.
 *
 * Why we need this: the connect-wallet flow fires `/api/auth/wallet/bootstrap`
 * fire-and-forget after signup. If the user closes the tab, kills the
 * network, or otherwise interrupts that fetch, the mints may not complete
 * and the user lands without their starter NFTs. Vercel can't run the
 * mints in a true background job, so the only recovery path is "every
 * future page mount checks and re-kicks if needed".
 *
 * The bootstrap endpoint is idempotent (each step gates on its own
 * completion signal: drones.tokenId, skin/mod row presence,
 * users.starter_volt_minted_at, users.starter_gas_sent_at). So a
 * redundant call when everything's already done is a cheap no-op
 * (~one DB read per asset, then return).
 *
 * Gating: the sessionStorage flag prevents a navigation-heavy session
 * from firing this 10x. Demo users skip entirely (no walletAddress).
 */
export function useBootstrapSelfHeal() {
  const { user, status } = useSession();

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (!user?.walletAddress) return;
    if (typeof window === 'undefined') return;
    if (window.sessionStorage.getItem(BOOTSTRAP_FIRED_KEY)) return;

    // Mark BEFORE firing so a second mount in the same render cycle
    // (Strict Mode double-invoke, fast back-and-forth nav) doesn't
    // race a duplicate POST.
    window.sessionStorage.setItem(BOOTSTRAP_FIRED_KEY, String(Date.now()));

    fetch('/api/auth/wallet/bootstrap', { method: 'POST' }).catch((err) => {
      // Self-heal is best-effort; if THIS attempt fails too, the next
      // tab session will retry. We don't clear the flag on failure
      // because that would cause every subsequent navigation in this
      // tab to retry too (could spam the endpoint on a bad network).
      console.warn('[bootstrap-self-heal] POST failed:', err);
    });
  }, [status, user?.walletAddress]);
}
