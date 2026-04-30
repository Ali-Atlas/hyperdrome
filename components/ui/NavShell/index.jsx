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

/* sessionStorage key carrying the user's last audio preference. Used
 * to attempt a resume after a hard reload (the singleton below survives
 * client-side navigations on its own; sessionStorage covers the
 * page-reload case where the JS module is freshly evaluated). Browsers
 * may still gate the resume behind their autoplay policy if no fresh
 * user gesture is available; in that case the toggle simply renders
 * muted and the user re-enables manually. */
const AUDIO_PREF_KEY = 'hyperdrome.audio.playing';

/* Module-scoped audio singleton. NavShell is rendered per-page (each
 * route's page component wraps its content in <NavShell>), so a
 * navigation unmounts NavShell and remounts a fresh instance. A useRef
 * inside the component is reset on remount, which means an <audio>
 * JSX element + ref recreates the element and resets currentTime to 0
 * on every navigation - the audible "music restarts" symptom.
 *
 * Holding the HTMLAudioElement in module scope (created once via
 * `new Audio()`, never inserted into the React tree) decouples its
 * lifetime from the component tree. NavShell remounts pick up the
 * existing element with its currentTime preserved; play()/pause()
 * are no-ops if the element is already in the requested state. The
 * `audio.paused` field is the source of truth for the icon state;
 * NavShell's React state just mirrors it via play/pause events.
 *
 * Module-level mutable state (let) is OK here because there's only
 * ever one NavShell mounted at a time and the singleton represents
 * a true browser-level resource (the <audio> element + its playback
 * state). It survives until the JS module unloads, i.e. a hard
 * reload; sessionStorage above covers that case. */
let sharedAudio = null;
let sharedAutoplayAttempted = false;

function getOrCreateSharedAudio() {
  if (typeof window === 'undefined') return null;
  if (!sharedAudio) {
    sharedAudio = new Audio('/audio/hero-bg.mp3');
    sharedAudio.loop = true;
    sharedAudio.preload = 'none';
  }
  return sharedAudio;
}

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

  /* Persistent in-app audio. The HTMLAudioElement is held in module
   * scope (see getOrCreateSharedAudio above) so it survives
   * NavShell remounts on client-side navigations. React state here
   * is just a mirror of audio.paused, kept in sync via play/pause
   * event listeners attached on every mount. */
  const [audioPlaying, setAudioPlaying] = useState(() => {
    if (typeof window === 'undefined') return false;
    const a = getOrCreateSharedAudio();
    return a ? !a.paused : false;
  });

  useEffect(() => {
    const audio = getOrCreateSharedAudio();
    if (!audio) return undefined;
    // Sync mirror state with the shared element's actual paused/playing
    // value on mount, then keep it in sync via events. Covers the
    // remount case where audio kept playing but the new component's
    // initial state read could race with a play() in flight.
    setAudioPlaying(!audio.paused);
    const onPlay = () => setAudioPlaying(true);
    const onPause = () => setAudioPlaying(false);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, []);

  useEffect(() => {
    // First-time autoplay attempt after a hard reload, gated by the
    // module-scoped flag so it only fires once per page load even
    // across multiple NavShell mounts. Skipped if the audio element
    // is already playing (handles the navigation case).
    if (typeof window === 'undefined' || sharedAutoplayAttempted) return;
    sharedAutoplayAttempted = true;
    const audio = getOrCreateSharedAudio();
    if (!audio || !audio.paused) return;
    const wasPlaying =
      window.sessionStorage.getItem(AUDIO_PREF_KEY) === 'true';
    if (!wasPlaying) return;
    audio.play().catch(() => {
      /* Browser autoplay policy blocked the resume; the toggle stays
       * muted and the user re-enables on their next click. Drop the
       * stale flag so a future reload doesn't keep retrying. */
      window.sessionStorage.setItem(AUDIO_PREF_KEY, 'false');
    });
  }, []);

  const toggleAudio = () => {
    const audio = getOrCreateSharedAudio();
    if (!audio) return;
    if (audio.paused) {
      audio
        .play()
        .then(() => {
          window.sessionStorage.setItem(AUDIO_PREF_KEY, 'true');
        })
        .catch(() => {});
    } else {
      audio.pause();
      window.sessionStorage.setItem(AUDIO_PREF_KEY, 'false');
    }
  };

  const renderAudioToggle = () => (
    <button
      type="button"
      onClick={toggleAudio}
      className={cn(styles.audioToggle, styles.audioToggleFooter)}
      aria-label={
        audioPlaying ? 'Mute background audio' : 'Play background audio'
      }
      aria-pressed={audioPlaying}
    >
      {audioPlaying ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
    </button>
  );

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
      {user && renderAudioToggle()}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Inline speaker icons. Mirror the landing-page HeroAudio toggle so both    */
/* corner controls read identically. No icon-library import - keeps NavShell */
/* a tiny island.                                                            */
/* -------------------------------------------------------------------------- */

function SpeakerOnIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function SpeakerOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Countdown bar - fixed bottom strip showing the next-batch + race-locks    */
/* timers. Polls /api/races/next every 30s and /api/races/upcoming every    */
/* 15s. Renders only for authenticated users (gated above).                  */
/* -------------------------------------------------------------------------- */

/* The Mod Lock timer counts down to when matchups lock for execution.
   Server side, that's `scheduled_at = createdAt + PENDING_WINDOW_SECONDS`
   on each PENDING race. Equivalently from the client's perspective, the
   strategy window closes `PENDING_WINDOW_SECONDS` BEFORE the next race
   cycle fires - so we derive it from the same `nextRaceAt` the
   Next-Round timer uses. Keep this constant in lockstep with
   `services/race.service.js#PENDING_WINDOW_SECONDS`. */
const MOD_LOCK_LEAD_MS = 120 * 1000;

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
        </>
      )}
    </div>
  );
}

