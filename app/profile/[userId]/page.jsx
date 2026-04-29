'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Hexagon } from 'lucide-react';
import styles from './page.module.css';

/**
 * Demo build: profile pages are stubbed. Anyone clicking through to a
 * player profile (from leaderboard, race detail, marketplace seller link,
 * etc.) lands here and gets a branded "not available in demo" message
 * with a Go Back affordance instead of a blank page.
 *
 * router.back() falls back to the landing page when there is no history
 * (e.g. opening a profile URL in a fresh tab). The Home link is the
 * fallback for that case AND keeps a keyboard-accessible safety net.
 */
export default function PlayerProfilePage() {
  const router = useRouter();

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <Hexagon
          size={48}
          strokeWidth={2}
          className={styles.icon}
          aria-hidden="true"
        />
        <h1 className={styles.title}>Player Profile</h1>
        <p className={styles.message}>
          Player profiles are not available in the demo.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            onClick={() => router.back()}
            className={styles.primary}
          >
            Go Back
          </button>
          <Link href="/drones" className={styles.secondary}>
            My Drones
          </Link>
        </div>
      </div>
    </main>
  );
}
