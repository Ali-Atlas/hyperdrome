'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Cpu,
  Flag,
  Map,
  Trophy,
  Store,
  BookOpen,
  HelpCircle,
  Menu,
  LogOut,
  Hexagon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSession } from '@/hooks/useSession';
import { useVoltBalance } from '@/hooks/useVoltBalance';
import { useBootstrapSelfHeal } from '@/hooks/useBootstrapSelfHeal';
import VoltIcon from '@/components/ui/VoltIcon';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { useUpcomingRaces } from '@/lib/upcoming-races-store';
import { useAccount, useDisconnect } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { wasWalletAuthed, markWalletAuthed, clearWalletAuthCache } from '@/lib/wallet-auth-cache';
import styles from './NavShell.module.css';

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/drones', label: 'My Drones', Icon: Cpu },
  { href: '/races', label: 'Races', Icon: Flag },
  { href: '/tracks', label: 'Tracks', Icon: Map },
  { href: '/leaderboard', label: 'Leaderboard', Icon: Trophy },
  { href: '/marketplace', label: 'Marketplace', Icon: Store },
  { href: '/guide', label: 'Guide', Icon: BookOpen },
  { href: '/faq', label: 'FAQ', Icon: HelpCircle },
];

// Module-scope cache of `${userId}:${addressLower}` keys already POSTed to
// /api/user/wallet during this tab's lifetime. NavShell mounts per-page so a
// useRef would reset on every navigation; this Set survives remounts and
// silences the steady stream of duplicate binds (which the server otherwise
// answers with 200 on no-op or 409 if the address belongs to another user).
const BOUND_ADDRESSES = new Set();

// Module-scope set of lowercased addresses for which a POST /api/auth/wallet
// is currently in flight. Two NavShell renders (desktop sidebar + mobile
// top-bar) both render HeaderConnectWallet; without this gate they'd both
// fire concurrent sign-in attempts on the same address. Cleared in `finally`
// so a sign-out -> reconnect-same-wallet flow isn't permanently blocked.
const WALLET_AUTH_IN_FLIGHT = new Set();

const EXPLORER_BASE = 'https://megaeth-testnet-v2.blockscout.com';

// Anchor the dropdown to the trigger, flipping vertical direction based
// on which half of the viewport the trigger sits in. Top half (mobile
// header) opens downward; bottom half (desktop sidebar footer) opens
// upward. Right edge always aligns with the trigger's so the menu grows
// leftward and never clips off the right side of the viewport.
function computeMenuPos(triggerEl) {
  const r = triggerEl.getBoundingClientRect();
  const right = window.innerWidth - r.right;
  const opensDown = r.top + r.height / 2 < window.innerHeight / 2;
  return opensDown
    ? { top: r.bottom + 6, right }
    : { bottom: window.innerHeight - r.top + 6, right };
}

/**
 * Wallet connect button + connected-state dropdown. Only renders for
 * authenticated users since the bind API requires a session. On connect,
 * fires a fire-and-forget POST to /api/user/wallet so the address is
 * persisted against the user record (server-side write is idempotent on
 * the same address).
 *
 * Connected state opens a dropdown with three actions:
 *   - View on Explorer: opens BlockScout in a new tab.
 *   - Copy Address: writes the full address to clipboard, briefly swaps
 *     the button label to "Copied!" as feedback.
 *   - Disconnect: confirms, then calls `onSignOut` (lifted from
 *     NavShell) which both disconnects the wallet AND clears the
 *     NextAuth session, redirecting to '/'.
 *
 * `onSignOut` is passed down rather than re-implemented here so the
 * dropdown's disconnect path is identical to the sidebar Sign Out button -
 * one source of truth for wallet-cache clearing + wallet disconnect +
 * session sign-out + redirect.
 */
function WalletButton({ onSignOut }) {
  const { user } = useSession();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const [copied, setCopied] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Track client-side mount so the createPortal call is gated past SSR.
  // Required because next.js still server-renders 'use client' components.
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!user || !isConnected || !address) return;
    const key = `${user.id}:${address.toLowerCase()}`;
    if (BOUND_ADDRESSES.has(key)) return;
    BOUND_ADDRESSES.add(key);
    fetch('/api/user/wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: address }),
    }).catch((err) => {
      // Network failure - clear the cache entry so a future render can retry.
      // Server-side rejections (4xx/5xx with a body) resolve, not reject, so
      // they keep the entry in place and won't be retried this session.
      BOUND_ADDRESSES.delete(key);
      console.error('[wallet] bind failed:', err);
    });
  }, [user, isConnected, address]);

  // Outside-click close. With the menu rendered via portal into
  // document.body, it's no longer a DOM descendant of the trigger - we
  // check both refs so a click on a menu item (which lives in the portal
  // tree) doesn't immediately close the menu before the click handler
  // fires. Listener attached only while the menu is open.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e) {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (trigger && trigger.contains(e.target)) return;
      if (menu && menu.contains(e.target)) return;
      setMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen]);

  // External disconnect (e.g. user revokes the site in MetaMask) should
  // collapse the menu - otherwise it'd hang open over a "Connect Wallet"
  // button that no longer matches its state.
  useEffect(() => {
    if (!isConnected) {
      setMenuOpen(false);
      setCopied(false);
    }
  }, [isConnected]);

  // Re-anchor the dropdown to the trigger on resize while it's open. We
  // don't need a scroll listener because both render contexts keep the
  // trigger in a fixed/sticky position (desktop sidebar: position: fixed;
  // mobile top bar: position: sticky) - the trigger never moves relative
  // to the viewport while the rest of the page scrolls. Resize is the only
  // way the trigger's viewport coordinates can change.
  useEffect(() => {
    if (!menuOpen) return;
    function update() {
      if (!triggerRef.current) return;
      setMenuPos(computeMenuPos(triggerRef.current));
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [menuOpen]);

  if (!user) return null;

  if (!isConnected) {
    return (
      <button type="button" className={styles.walletBtn} onClick={openConnectModal}>
        Connect Wallet
      </button>
    );
  }

  const truncated = `${address.slice(0, 6)}...${address.slice(-4)}`;

  function handleViewExplorer() {
    setMenuOpen(false);
    window.open(`${EXPLORER_BASE}/address/${address}`, '_blank', 'noopener,noreferrer');
  }

  async function handleCopyAddress() {
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('[wallet] clipboard write failed:', err);
    }
  }

  function handleDisconnect() {
    setMenuOpen(false);
    setConfirmOpen(true);
  }

  // Compute the dropdown coords synchronously on open so the menu paints
  // in the right place on the first render - avoids the one-frame flash
  // you get when a useEffect-driven recalc fires after layout. Using
  // position: fixed (rather than absolute) escapes the `.mobileUser`
  // ancestor's overflow:hidden clip and the desktop sidebar's viewport
  // bottom edge - both of which were eating the dropdown previously.
  //
  // Direction auto-flips: opens DOWN from the trigger when the trigger
  // sits in the top half of the viewport (mobile/header top bar), and
  // UP when it sits in the bottom half (desktop sidebar footer). Both
  // anchors share the right edge with the trigger so the menu grows
  // leftward and never clips off the right side of the viewport.
  function toggleMenu() {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    if (triggerRef.current) {
      setMenuPos(computeMenuPos(triggerRef.current));
    }
    setMenuOpen(true);
  }

  // Menu is rendered as a portal into document.body so it sits outside
  // every ancestor's stacking / overflow / containing-block tree. This is
  // what makes the menu reliably visible from BOTH the mobile/header top
  // bar (whose `.mobileUser` ancestor has overflow: hidden) and the
  // desktop sidebar (whose trigger sits low enough that an absolute or
  // even fixed-but-contained menu was extending past the visible area).
  // Gated on `mounted` so the createPortal call doesn't fire during SSR.
  const menu =
    menuOpen && menuPos && mounted
      ? createPortal(
          <div ref={menuRef} className={styles.walletMenu} role="menu" style={menuPos}>
            <button
              type="button"
              role="menuitem"
              className={styles.walletMenuItem}
              onClick={handleViewExplorer}
            >
              View on Explorer
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.walletMenuItem}
              onClick={handleCopyAddress}
            >
              Copy Address
            </button>
            <button
              type="button"
              role="menuitem"
              className={`${styles.walletMenuItem} ${styles.walletMenuItemDanger}`}
              onClick={handleDisconnect}
            >
              Disconnect
            </button>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.walletBtn} ${styles.walletBtnConnected}`}
        onClick={toggleMenu}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        {copied ? 'Copied!' : truncated}
      </button>
      {menu}
      {confirmOpen && (
        <ConfirmModal
          title="Disconnect Wallet"
          message="This will sign you out of the game."
          confirmLabel="Disconnect"
          cancelLabel="Cancel"
          onConfirm={() => {
            setConfirmOpen(false);
            onSignOut();
          }}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Unauthenticated Connect Wallet entry point. Rendered in the user-area
 * slot when there's no session. Two states:
 *
 *   - Wallet not attached: button opens RainbowKit. On connection the
 *     auto-auth effect fires `POST /api/auth/wallet` and routes to
 *     /dashboard.
 *   - Wallet already attached (returning visitor whose RainbowKit
 *     session restored on landing): the auto-auth effect runs on mount
 *     so the user lands in the app without an extra click. Button
 *     surface shows a busy state during the round-trip.
 *
 * Loop guards (the dashboard previously cycled through reload->POST->reload
 * when `/api/auth/wallet` returned a redirectUrl on every page render):
 *
 *   1. Wait for `useSession().status` to resolve before deciding. During
 *      the initial 'loading' window `user` is null even when a JWT cookie
 *      exists; firing during loading would re-POST against an existing
 *      session.
 *   2. If `user.walletAddress` already matches the connected address,
 *      skip the POST entirely. The session is the canonical signal that
 *      this address is signed in.
 *   3. `WALLET_AUTH_IN_FLIGHT` (module-scope) prevents the desktop +
 *      mobile NavShell instances from both POSTing the same address.
 *   4. Use `router.push` (no full reload) so React state, RainbowKit
 *      state, and the in-flight Set survive the redirect. Skip the push
 *      when already on the target path.
 */
function HeaderConnectWallet() {
  const { user, status, update } = useSession();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const router = useRouter();
  const pathname = usePathname();
  const [authing, setAuthing] = useState(false);

  useEffect(() => {
    // Wait for the session to resolve. During the initial 'loading'
    // window `user` is null even when a JWT cookie exists; firing here
    // would re-POST against an existing session.
    if (status === 'loading') return;
    if (!isConnected || !address) return;
    const lowerAddress = address.toLowerCase();
    // Already signed in as this exact wallet - the canonical "no-POST
    // needed" gate. After a successful round-trip update() refreshes
    // session.user.walletAddress, this comparison passes, and the
    // effect short-circuits on every subsequent render / navigation.
    if (user?.walletAddress === lowerAddress) return;
    // Persistent tab-lifetime cache: this address has already authed
    // successfully in this tab (via this component or HeroConnectWallet).
    // Skip even if `useSession` hasn't yet picked up the cookie.
    if (wasWalletAuthed(lowerAddress)) return;
    // A sibling NavShell instance (desktop vs mobile) is already POSTing
    // for this address. Skip rather than racing the server-side signIn.
    if (WALLET_AUTH_IN_FLIGHT.has(lowerAddress)) return;
    WALLET_AUTH_IN_FLIGHT.add(lowerAddress);

    let cancelled = false;
    setAuthing(true);
    (async () => {
      try {
        const res = await fetch('/api/auth/wallet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ walletAddress: address }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.error('[wallet] sign-in failed:', data?.error);
          return;
        }
        // Mark BEFORE the await so a remount triggered by router.push
        // sees the cache hit on its first effect run (the await update()
        // below isn't durable enough on its own - it propagates after
        // the next render).
        markWalletAuthed(lowerAddress);
        if (cancelled) return;
        // Force next-auth to re-fetch /api/auth/session so the local
        // SessionProvider state picks up the new JWT cookie. Without
        // this the UI sticks on "Signing in..." until the user
        // manually refreshes - useSession's lazy-poll won't refetch
        // for a while otherwise.
        await update();
        if (cancelled) return;
        // Kick the async on-chain bootstrap (NFT mints + VOLT + gas)
        // for new wallet signups. Idempotent endpoint, fire-and-forget.
        // Mirrors the HeroConnectWallet flow: announce the mint window
        // so useVoltBalance shows '—' instead of '0', then nudge an
        // immediate refetch when bootstrap returns.
        if (data?.bootstrapNeeded) {
          // Seed sessionStorage directly (not just dispatching the
          // event) so the hook can hydrate on mount/navigation when
          // its listener wasn't attached yet. See HeroConnectWallet
          // for the full reasoning.
          const ttlMs = 30_000;
          try {
            window.sessionStorage.setItem('volts:awaiting-mint-until', String(Date.now() + ttlMs));
            // Flag that bootstrap was kicked here so the self-heal
            // hook (useBootstrapSelfHeal) doesn't fire a redundant
            // second call on the next page mount in this tab.
            window.sessionStorage.setItem('bootstrap-fired', String(Date.now()));
          } catch {
            /* private mode / quota - hook still works once it mounts */
          }
          window.dispatchEvent(
            new CustomEvent('volts:awaiting-mint', {
              detail: { ttlMs },
            })
          );
          fetch('/api/auth/wallet/bootstrap', { method: 'POST' })
            .then(() => {
              window.dispatchEvent(new CustomEvent('volts:update', { detail: {} }));
            })
            .catch((err) => {
              console.warn('[wallet] bootstrap kick-off failed:', err);
            });
        }
        const target = data.redirectUrl || '/dashboard';
        if (pathname !== target) router.push(target);
        // Re-fetch RSC so the layout server components also pick up
        // the new session cookie.
        router.refresh();
      } catch (err) {
        console.error('[wallet] sign-in error:', err);
      } finally {
        WALLET_AUTH_IN_FLIGHT.delete(lowerAddress);
        if (!cancelled) setAuthing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, user?.walletAddress, isConnected, address, pathname, router, update]);

  if (isConnected) {
    return (
      <button type="button" className={styles.connectWallet} disabled aria-busy="true">
        Signing in...
      </button>
    );
  }

  return (
    <button type="button" className={styles.connectWallet} onClick={() => openConnectModal?.()}>
      Connect Wallet
    </button>
  );
}

/**
 * Application layout shell with desktop sidebar + mobile drawer nav.
 * Reads the session directly - no need to pass `user` from every page.
 * @param {object} props
 * @param {React.ReactNode} props.children
 */
export default function NavShell({ children }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { user, signOut } = useSession();
  const { isConnected: walletConnected, address: walletAddress } = useAccount();
  const { disconnect } = useDisconnect();
  // Wallet-auth users see their session vanish AND their wallet drop on
  // sign-out, so the next CONNECT WALLET press starts from a clean slate
  // (otherwise the still-connected wallet would skip the RainbowKit modal
  // and re-auth into the same session). For demo users it's a no-op
  // since useDisconnect on a non-connected state does nothing.
  const onSignOut = () => {
    // Clear the persistent auth cache so a sign-out -> reconnect-same
    // -wallet flow can re-auth. Without this the user would be stuck
    // unable to sign back in until they hard-reload the tab.
    clearWalletAuthCache();
    if (walletConnected) disconnect();
    signOut({ redirectTo: '/' });
  };

  // Single source of truth for VOLT across NavShell and every other
  // consumer (stat editor, marketplace, drone manager). Resolves
  // `volts:update` override > on-chain poll, with the JWT mirror only
  // for demo users; see hooks/useVoltBalance for the full contract.
  // `balanceLoading` is true while a wallet-bound user is waiting for
  // the first on-chain fetch to resolve - we render '—' in that window
  // so the navbar never flashes the JWT-mirror value before swapping
  // to the real on-chain balance on refresh.
  const { balance: displayBalance, loading: balanceLoading } = useVoltBalance();

  // If a fresh wallet user lands in the app without the connect-flow's
  // bootstrap having completed (tab closed, network drop), this hook
  // re-kicks the idempotent bootstrap endpoint once per tab session.
  useBootstrapSelfHeal();

  const renderLinks = () =>
    NAV_LINKS.map(({ href, label, Icon }) => {
      const active = pathname === href || pathname?.startsWith(`${href}/`);
      return (
        <Link
          key={href}
          href={href}
          className={cn(styles.link, active && styles.linkActive)}
          onClick={() => setOpen(false)}
        >
          <Icon size={18} aria-hidden="true" />
          <span>{label}</span>
        </Link>
      );
    });

  // Demo users (no walletAddress on the user record) get a pure
  // off-chain experience: username + DB volts + sign out, no wallet
  // chip and no path to bind a wallet from inside the app. The
  // "connect a wallet to go on-chain" path is sign out → landing page
  // → Connect Wallet, never an in-app upgrade. Wallet users see the
  // address chip + on-chain balance.
  const isWalletUser = !!user?.walletAddress;
  const renderUserArea = () =>
    user ? (
      <div className={styles.userArea}>
        <div className={styles.username}>{user.username ?? user.email}</div>
        <div className={styles.pointsRow}>
          <div className={styles.points}>
            <VoltIcon size={14} style={{ marginRight: 4 }} />
            {balanceLoading ? '—' : displayBalance.toLocaleString()}
          </div>
          {isWalletUser && <WalletButton onSignOut={onSignOut} />}
        </div>
        <button type="button" className={styles.signOut} onClick={onSignOut}>
          <LogOut size={14} aria-hidden="true" />
          <span>Sign Out</span>
        </button>
      </div>
    ) : (
      <HeaderConnectWallet />
    );

  return (
    <div className={styles.shell}>
      {/* Desktop sidebar */}
      <aside className={styles.sidebar} aria-label="Primary">
        <Link href="/dashboard" className={styles.logo}>
          <Hexagon size={18} strokeWidth={3} className={styles.logoIcon} aria-hidden="true" />
          <span className={styles.logoTextGroup}>
            <span className={styles.logoText}>Hyperdrome</span>
            <span className={styles.logoBeta}>beta</span>
          </span>
        </Link>
        <nav className={styles.nav}>{renderLinks()}</nav>
        <div className={styles.sidebarFooter}>{renderUserArea()}</div>
      </aside>

      {/* Mobile top bar */}
      <header className={styles.mobileBar}>
        <button
          type="button"
          className={styles.menuBtn}
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
        >
          <Menu size={20} />
        </button>
        {user ? (
          <div className={styles.mobileUser}>
            <span className={styles.mobileUsername}>{user.username ?? user.email}</span>
            <span className={styles.mobileSep}>|</span>
            <span className={styles.mobilePoints}>
              <VoltIcon size={13} style={{ marginRight: 4 }} />
              {balanceLoading ? '—' : displayBalance.toLocaleString()}
            </span>
            {isWalletUser && <WalletButton onSignOut={onSignOut} />}
          </div>
        ) : (
          <div className={styles.mobileUser}>
            <HeaderConnectWallet />
          </div>
        )}
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)} role="presentation">
          <aside
            className={styles.drawer}
            onClick={(e) => e.stopPropagation()}
            aria-label="Mobile navigation"
          >
            <div className={styles.drawerHeader}>
              <span className={styles.logo}>
                <Hexagon size={18} strokeWidth={3} className={styles.logoIcon} aria-hidden="true" />
                <span className={styles.logoTextGroup}>
                  <span className={styles.logoText}>Hyperdrome</span>
                  <span className={styles.logoBeta}>beta</span>
                </span>
              </span>
            </div>
            <nav className={styles.nav}>{renderLinks()}</nav>
            <div className={styles.sidebarFooter}>{renderUserArea()}</div>
          </aside>
        </div>
      )}

      <main className={styles.main}>{children}</main>

      {user && <CountdownBar />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Countdown bar - fixed bottom strip showing the next-batch + race-locks    */
/* timers. Polls /api/races/next every 30s and /api/races/upcoming every    */
/* 15s. Renders only for authenticated users (gated above).                  */
/* -------------------------------------------------------------------------- */

/* The Strategy Lock timer counts down to when matchups lock for
 * execution (player can no longer swap mods after this point).
 * Server-side that target is `scheduled_at = createdAt + PENDING_WINDOW_SECONDS`
 * on each PENDING race (PENDING_WINDOW_SECONDS = 120s in
 * `services/race.service.js`). Matchups are created at the start of a
 * cron cycle, and the next cron cycle (the `batchAt` value the
 * Next-Round timer uses) fires CRON_CYCLE_SECONDS later. So:
 *
 *   scheduled_at = batchAt - CRON_CYCLE_SECONDS + PENDING_WINDOW_SECONDS
 *                = batchAt - (CRON_CYCLE_SECONDS - PENDING_WINDOW_SECONDS)
 *                = batchAt - STRATEGY_LOCK_LEAD_MS
 *
 * With the current 180s cron cadence and 120s strategy window the lead
 * is 60s, so the timer reads ~120s at the start of a cycle (the full
 * strategy window) and counts down to 0 when mods lock. Update this
 * constant if either the cron cadence (vercel.json's every-3-minute
 * schedule) or `PENDING_WINDOW_SECONDS` changes. */
const STRATEGY_LOCK_LEAD_MS = 60 * 1000;

/* sessionStorage keys for the countdown bar. These let a remount (every
 * SPA-style page navigation) hydrate from the last known values
 * instantly, before the first poll returns. Without this, the footer
 * flickers '--:--' every time the user changes pages because NavShell
 * remounts and the countdown's state resets to its initial empty
 * values. The upcoming-races list lives in `lib/upcoming-races-store.js`
 * (module-scoped, survives remounts) so it doesn't need a cache key
 * here. */
const CB_STORAGE = {
  batchAt: 'nav.countdown.batchAt',
  paused: 'nav.countdown.paused',
};

/* Drop a cached batchAt that's more than 5 minutes old. The race cycle
 * is 3 minutes, so a >5min stale timestamp means we missed at least one
 * processing window — show '--:--' rather than a guaranteed-wrong stale
 * value. Fresher misses ride out within the next 2-30s poll. */
const CB_BATCH_TTL_MS = 5 * 60 * 1000;

function readCachedBatchAt() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CB_STORAGE.batchAt);
    if (!raw) return null;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return null;
    if (ts < Date.now() - CB_BATCH_TTL_MS) return null;
    return ts;
  } catch {
    return null;
  }
}

function readCachedPaused() {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(CB_STORAGE.paused) === 'true';
  } catch {
    return false;
  }
}

function writeCache(key, value) {
  if (typeof window === 'undefined') return;
  try {
    if (value == null) {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  } catch {
    /* quota / privacy mode - safe to ignore */
  }
}

function CountdownBar() {
  /* batchAt + paused hydrate from sessionStorage on mount via lazy
   * initializers. Server-side render (and the matching first hydration
   * frame) get null/false because window is undefined; subsequent
   * client mounts (SPA navigation) read the last successful poll's
   * values and render them instantly while the new poll is in flight. */
  const [batchAt, setBatchAt] = useState(readCachedBatchAt);
  const [paused, setPaused] = useState(readCachedPaused);
  const [now, setNow] = useState(() => Date.now());
  /* Upcoming races come from the shared store in
   * `lib/upcoming-races-store.js` - same source the dashboard's Live
   * Race Feed reads, so the footer's number chips and the dashboard's
   * "your upcoming" rows are guaranteed to agree. The store handles
   * adaptive polling (15s steady, 3s when partial) and the
   * hold-until-full-set logic that prevents the "Races: 1" -> "Races:
   * 1 2 3" stutter as the cron creates matchups sequentially. */
  const { races: upcomingRaces } = useUpcomingRaces();

  // Adaptive poll for /api/races/next. The cadence flips between 30s
  // (the next-batch timestamp is comfortably in the future) and 2s
  // (the current batch has elapsed and the cron is mid-process).
  // Recursive setTimeout (instead of setInterval) so each tick can
  // pick its own delay based on the freshest response: when we have
  // a future timestamp we aim to poll just past its expiration so
  // RACING IN PROGRESS lights up and fast-poll mode takes over within
  // ~2s of the server finishing the cycle. Closest to instant we can
  // get without websockets.
  useEffect(() => {
    let cancelled = false;
    let timerId = null;
    const FAST_MS = 2_000;
    const SLOW_MS = 30_000;

    const tick = async () => {
      let nextBatchAt = null;
      try {
        const res = await fetch('/api/races/next');
        const body = await res.json();
        if (cancelled) return;
        if (body?.data?.paused) {
          setPaused(true);
          writeCache(CB_STORAGE.paused, 'true');
          /* DO NOT clear batchAt here. The paused branch hides the
             timer regardless, and clearing it would force a flicker
             back to '--:--' if the server briefly bounces between
             paused and not-paused (or if a remount lands during a
             paused poll). Keep the last known value cached so unpause
             resumes instantly. */
        } else if (body?.data) {
          setPaused(false);
          writeCache(CB_STORAGE.paused, 'false');
          nextBatchAt = body.data.nextRaceAt ? new Date(body.data.nextRaceAt).getTime() : null;
          setBatchAt(nextBatchAt);
          writeCache(CB_STORAGE.batchAt, nextBatchAt != null ? String(nextBatchAt) : null);
        }
      } catch {
        /* network blip - fall through to scheduling */
      }
      if (cancelled) return;
      // remaining > 100 ms: aim to poll right after expiration (or at
      // 30s, whichever comes first). 100ms buffer absorbs clock skew so
      // the very next poll lands AFTER the new cycle has started.
      // remaining <= 100 ms (or null): we're already in / past the
      // server-processing window; fast-poll until a fresh future
      // timestamp comes back.
      const remaining = nextBatchAt != null ? nextBatchAt - Date.now() : 0;
      const delay = remaining > 100 ? Math.min(remaining + 100, SLOW_MS) : FAST_MS;
      timerId = setTimeout(tick, delay);
    };

    tick();
    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, []);

  // 1s ticker drives the visible MM:SS for both items.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const formatRemaining = (target) => {
    if (target == null) return null;
    const remaining = Math.max(0, Math.floor((target - now) / 1000));
    const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
    const secs = String(remaining % 60).padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const batchText = formatRemaining(batchAt);
  // Once batchAt elapses, the cron tick is firing right now (or any
  // moment). Hold "RACING IN PROGRESS" until /api/races/next polls
  // back a fresh future timestamp - prevents the visible MM:SS from
  // jumping at 00:00 with stale data while the server catches up.
  const batchExpired = batchAt != null && batchAt <= now;
  // Derive the mod-lock target from the same next-race timestamp.
  const strategyLockAt = batchAt != null ? batchAt - STRATEGY_LOCK_LEAD_MS : null;
  const strategyLockExpired = strategyLockAt != null && strategyLockAt <= now;
  const strategyLockText = formatRemaining(strategyLockAt);

  return (
    <div className={styles.countdownBar} aria-label="Race timing">
      {paused ? (
        <span className={styles.countdownPaused}>Racing paused</span>
      ) : (
        <>
          <span className={styles.countdownItem}>
            {batchExpired ? (
              <span className={styles.countdownInProgress}>RACING IN PROGRESS</span>
            ) : (
              <>
                <span className={styles.countdownLabel}>Next Auto-Race in</span>
                <span className={styles.countdownValue}>{batchText ?? '--:--'}</span>
              </>
            )}
          </span>
          <span className={styles.countdownSep} aria-hidden="true">
            ·
          </span>
          <span className={`${styles.countdownItem} ${styles.countdownItemStrategyLock}`}>
            {strategyLockExpired ? (
              <span className={`${styles.countdownLockedText} ${styles.countdownValueWarning}`}>
                LOCKED IN
              </span>
            ) : (
              <>
                <span className={styles.countdownLabel}>Strategy Lock in</span>
                <span className={`${styles.countdownValue} ${styles.countdownValueWarning}`}>
                  {strategyLockText ?? '--:--'}
                </span>
              </>
            )}
          </span>
          {/* Dot separator before the Races group, matching the dot
              between Next Round and Strategy Lock so all three footer
              sections share one separator style. Hidden at the smallest
              mobile breakpoint via `.countdownSepRaces`. */}
          <span className={`${styles.countdownSep} ${styles.countdownSepRaces}`} aria-hidden="true">
            ·
          </span>
          <span className={styles.countdownRacesGroup}>
            <span className={styles.countdownLabel}>Races:</span>
            {/* Always render 3 number slots. A slot is an accent-teal
                link when there's an upcomingRaces entry at that
                index, otherwise a muted static span. The numbers
                never disappear / never blink in and out as the
                pending list churns - only the color + interactivity
                of each slot changes. The bar deliberately doesn't
                subscribe to pathname so it doesn't re-render on
                navigation. */}
            {[0, 1, 2].map((i) => {
              const race = upcomingRaces[i];
              return race ? (
                <Link key={race.id} href={`/races/${race.id}`} className={styles.countdownRaceLink}>
                  {i + 1}
                </Link>
              ) : (
                <span key={`races-slot-${i}`} className={styles.countdownRaceSlotEmpty}>
                  {i + 1}
                </span>
              );
            })}
          </span>
        </>
      )}
    </div>
  );
}
