'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  LogIn,
  LogOut,
  Hexagon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSession } from '@/hooks/useSession';
import VoltIcon from '@/components/ui/VoltIcon';
import styles from './NavShell.module.css';

const NAV_LINKS = [
  { href: '/dashboard',   label: 'Dashboard',   Icon: LayoutDashboard },
  { href: '/drones',      label: 'My Drones',   Icon: Cpu },
  { href: '/races',       label: 'Races',       Icon: Flag },
  { href: '/tracks',      label: 'Tracks',      Icon: Map },
  { href: '/leaderboard', label: 'Leaderboard', Icon: Trophy },
  { href: '/marketplace', label: 'Marketplace', Icon: Store },
  { href: '/guide',       label: 'Guide',       Icon: BookOpen },
  { href: '/faq',         label: 'FAQ',         Icon: HelpCircle },
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

  // NextAuth's session.user.points is stale until the JWT refreshes, which
  // doesn't happen after a purchase. We listen on a global `volts:update`
  // CustomEvent that purchase handlers (marketplace buy / pack open /
  // capsule open / NPC drone create) dispatch with the post-mutation
  // balance returned by the server. Once an event has fired we treat the
  // override as the source of truth so subsequent stale session reads
  // can't undo it within this NavShell mount.
  const [balanceOverride, setBalanceOverride] = useState(null);
  useEffect(() => {
    const handler = (e) => {
      const next = e?.detail?.balance;
      if (typeof next === 'number') setBalanceOverride(next);
    };
    window.addEventListener('volts:update', handler);
    return () => window.removeEventListener('volts:update', handler);
  }, []);
  const displayBalance = balanceOverride ?? user?.points ?? 0;

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
        <div className={styles.username}>
          {user.username ?? user.email}
        </div>
        <div className={styles.points}>
          <VoltIcon size={14} style={{ marginRight: 4 }} />
          {displayBalance.toLocaleString()}
        </div>
        <button
          type="button"
          className={styles.signOut}
          onClick={onSignOut}
        >
          <LogOut size={14} aria-hidden="true" />
          <span>Sign Out</span>
        </button>
      </div>
    ) : (
      <Link href="/login" className={styles.signIn}>
        <LogIn size={14} aria-hidden="true" />
        Sign in
      </Link>
    );

  return (
    <div className={styles.shell}>
      {/* Desktop sidebar */}
      <aside className={styles.sidebar} aria-label="Primary">
        <Link href="/dashboard" className={styles.logo}>
          <Hexagon
            size={18}
            strokeWidth={3}
            className={styles.logoIcon}
            aria-hidden="true"
          />
          <span className={styles.logoText}>Hyperdrome</span>
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
        {user && (
          <div className={styles.mobileUser}>
            <span className={styles.mobileUsername}>
              {user.username ?? user.email}
            </span>
            <span className={styles.mobileSep}>|</span>
            <span className={styles.mobilePoints}>
              <VoltIcon size={13} style={{ marginRight: 4 }} />
              {displayBalance.toLocaleString()}
            </span>
          </div>
        )}
      </header>

      {/* Mobile drawer */}
      {open && (
        <div
          className={styles.overlay}
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <aside
            className={styles.drawer}
            onClick={(e) => e.stopPropagation()}
            aria-label="Mobile navigation"
          >
            <div className={styles.drawerHeader}>
              <span className={styles.logo}>
                <Hexagon
            size={18}
            strokeWidth={3}
            className={styles.logoIcon}
            aria-hidden="true"
          />
                <span className={styles.logoText}>Hyperdrome</span>
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

/* The Mod Lock timer counts down to when matchups lock for execution.
 * Server-side that target is `scheduled_at = createdAt + PENDING_WINDOW_SECONDS`
 * on each PENDING race (PENDING_WINDOW_SECONDS = 120s in
 * `services/race.service.js`). Matchups are created at the start of a
 * cron cycle, and the next cron cycle (the `batchAt` value the
 * Next-Round timer uses) fires CRON_CYCLE_SECONDS later. So:
 *
 *   scheduled_at = batchAt - CRON_CYCLE_SECONDS + PENDING_WINDOW_SECONDS
 *                = batchAt - (CRON_CYCLE_SECONDS - PENDING_WINDOW_SECONDS)
 *                = batchAt - MOD_LOCK_LEAD_MS
 *
 * With the current 180s cron cadence and 120s strategy window the lead
 * is 60s, so the timer reads ~120s at the start of a cycle (the full
 * strategy window) and counts down to 0 when mods lock. Update this
 * constant if either the cron cadence (vercel.json's every-3-minute
 * schedule) or `PENDING_WINDOW_SECONDS` changes. */
const MOD_LOCK_LEAD_MS = 60 * 1000;

function CountdownBar() {
  const [batchAt, setBatchAt] = useState(null);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Poll the next-batch endpoint. 30s cadence as specced; the timer
  // continues to count locally between polls.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/races/next');
        const body = await res.json();
        if (cancelled || !body?.data) return;
        if (body.data.paused) {
          setPaused(true);
          setBatchAt(null);
          return;
        }
        setPaused(false);
        setBatchAt(body.data.nextRaceAt ? new Date(body.data.nextRaceAt).getTime() : null);
      } catch {
        /* keep stale */
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
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
  // Derive the mod-lock target from the same next-race timestamp.
  const modLockAt = batchAt != null ? batchAt - MOD_LOCK_LEAD_MS : null;
  const modLockExpired = modLockAt != null && modLockAt <= now;
  const modLockText = formatRemaining(modLockAt);

  return (
    <div className={styles.countdownBar} aria-label="Race timing">
      {paused ? (
        <span className={styles.countdownPaused}>Racing paused</span>
      ) : (
        <>
          <span className={styles.countdownItem}>
            <span className={styles.countdownLabel}>Next Round in</span>
            <span className={styles.countdownValue}>
              {batchText ?? '--:--'}
            </span>
          </span>
          <span className={styles.countdownSep} aria-hidden="true">
            ·
          </span>
          <span
            className={`${styles.countdownItem} ${styles.countdownItemModLock}`}
          >
            {modLockExpired ? (
              <span
                className={`${styles.countdownLockedText} ${styles.countdownValueWarning}`}
              >
                MOD LOCKED
              </span>
            ) : (
              <>
                <span className={styles.countdownLabel}>Mod Lock in</span>
                <span
                  className={`${styles.countdownValue} ${styles.countdownValueWarning}`}
                >
                  {modLockText ?? '--:--'}
                </span>
              </>
            )}
          </span>
          <span
            className={`${styles.countdownSep} ${styles.countdownSepMyRaces}`}
            aria-hidden="true"
          >
            ·
          </span>
          <Link href="/races?mine=1" className={styles.countdownMyRaces}>
            My Races
          </Link>
        </>
      )}
    </div>
  );
}

