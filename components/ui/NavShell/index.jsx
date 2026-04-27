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
          {(user.points ?? 0).toLocaleString()}
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
              {(user.points ?? 0).toLocaleString()}
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

function CountdownBar() {
  const [batchAt, setBatchAt] = useState(null);
  const [paused, setPaused] = useState(false);
  const [raceLockAt, setRaceLockAt] = useState(null);
  const [raceLockId, setRaceLockId] = useState(null);
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

  // Poll the user's pending races. 15s matches the dashboard.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/races/upcoming');
        const body = await res.json();
        if (cancelled || !body?.data) return;
        const races = body.data.races ?? [];
        if (races.length === 0) {
          setRaceLockAt(null);
          setRaceLockId(null);
          return;
        }
        // Already sorted by scheduled_at ascending; take the first.
        const next = races[0];
        setRaceLockAt(next.scheduledAt ? new Date(next.scheduledAt).getTime() : null);
        setRaceLockId(next.id);
      } catch {
        /* keep stale */
      }
    };
    tick();
    const id = setInterval(tick, 15_000);
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
  const raceLockText = formatRemaining(raceLockAt);
  const raceLockExpired = raceLockAt != null && raceLockAt - now <= 0;

  // Hide the race item entirely while racing is paused: pending races
  // are frozen until the kill-switch flips back on, so showing a
  // countdown or "in progress" pulse would mislead.
  const showRaceItem = !paused && raceLockAt != null;

  return (
    <div className={styles.countdownBar} aria-label="Race timing">
      {paused ? (
        <span className={styles.countdownPaused}>Racing paused</span>
      ) : (
        <span className={styles.countdownItem}>
          <span className={styles.countdownLabel}>Next batch in</span>
          <span className={styles.countdownValue}>
            {batchText ?? '--:--'}
          </span>
        </span>
      )}

      {showRaceItem && (
        <>
          <span className={styles.countdownSep} aria-hidden="true">
            ·
          </span>
          {raceLockExpired ? (
            <span className={styles.countdownItem}>
              <span className={styles.countdownInProgress}>
                Races in progress
              </span>
            </span>
          ) : (
            <Link
              href={raceLockId ? `/races/${raceLockId}` : '#'}
              className={styles.countdownItemLink}
            >
              <span className={styles.countdownLabel}>Race locks in</span>
              <span className={styles.countdownValue}>{raceLockText}</span>
            </Link>
          )}
        </>
      )}
    </div>
  );
}

