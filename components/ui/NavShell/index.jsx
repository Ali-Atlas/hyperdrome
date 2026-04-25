'use client';

import { useState } from 'react';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSession } from '@/hooks/useSession';
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
          POINTS: {(user.points ?? 0).toLocaleString()}
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
          <DroneMark />
          <span className={styles.logoText}>Drone Manager</span>
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
              POINTS: {(user.points ?? 0).toLocaleString()}
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
                <DroneMark />
                <span className={styles.logoText}>Drone Manager</span>
              </span>
            </div>
            <nav className={styles.nav}>{renderLinks()}</nav>
            <div className={styles.sidebarFooter}>{renderUserArea()}</div>
          </aside>
        </div>
      )}

      <main className={styles.main}>{children}</main>
    </div>
  );
}

function DroneMark() {
  return (
    <svg
      className={styles.logoIcon}
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="2.5" />
      <circle cx="5" cy="5" r="3" />
      <circle cx="19" cy="5" r="3" />
      <circle cx="5" cy="19" r="3" />
      <circle cx="19" cy="19" r="3" />
      <line x1="12" y1="12" x2="5" y2="5" />
      <line x1="12" y1="12" x2="19" y2="5" />
      <line x1="12" y1="12" x2="5" y2="19" />
      <line x1="12" y1="12" x2="19" y2="19" />
    </svg>
  );
}
