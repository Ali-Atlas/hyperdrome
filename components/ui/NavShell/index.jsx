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
import VoltIcon from '@/components/ui/VoltIcon';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { useUpcomingRaces } from '@/lib/upcoming-races-store';
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
  const onSignOut = () => signOut({ redirectTo: '/' });

  // Session points plus `volts:update` events (hooks/useVoltBalance).
  const { balance: displayBalance, loading: balanceLoading } = useVoltBalance();

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

  const renderUserArea = () =>
    user ? (
      <div className={styles.userArea}>
        <div className={styles.username}>{user.username ?? user.email}</div>
        <div className={styles.pointsRow}>
          <div className={styles.points}>
            <VoltIcon size={14} style={{ marginRight: 4 }} />
            {balanceLoading ? '—' : displayBalance.toLocaleString()}
          </div>
        </div>
        <button type="button" className={styles.signOut} onClick={onSignOut}>
          <LogOut size={14} aria-hidden="true" />
          <span>Sign Out</span>
        </button>
      </div>
    ) : (
      <Link href="/login" className={styles.connectWallet}>
        Sign in
      </Link>
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
          </div>
        ) : (
          <div className={styles.mobileUser}>
            <Link href="/login" className={styles.connectWallet}>
              Sign in
            </Link>
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
  // The mod-lock target: the committed batch's `lockAt` from /api/races/upcoming when the
  // viewer has a race in it, else derived from the same next-race timestamp.
  const upcomingLockAt = upcomingRaces[0]?.lockAt
    ? new Date(upcomingRaces[0].lockAt).getTime()
    : null;
  const strategyLockAt =
    upcomingLockAt ?? (batchAt != null ? batchAt - STRATEGY_LOCK_LEAD_MS : null);
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
