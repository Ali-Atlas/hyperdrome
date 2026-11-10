'use client';

import Link from 'next/link';
import { usePlayDemo } from '@/hooks/usePlayDemo';
import styles from './HeroActions.module.css';

/**
 * Hero primary CTA: Play Demo signs in a fresh demo account and goes to /dashboard, where the
 * on-chain bootstrap runs. Google sign-in is the top-right link (`app/HeroSignIn.jsx`); when the
 * demo is full or the per-IP limit is hit, the error links to it as well.
 *
 * Background audio for the hero is owned by `app/HeroAudio.jsx`
 * (landing page only); no audio runs inside the app shell.
 */
export default function HeroActions() {
  const { start, loading, error, limited } = usePlayDemo();

  return (
    <div className={styles.cluster}>
      <button type="button" onClick={start} disabled={loading} className={styles.primary}>
        {loading ? 'Loading...' : 'Play Demo'}
      </button>
      {error && (
        <p role="alert" className={styles.errorText}>
          {error}
          {limited && (
            <>
              {' '}
              <Link href="/login" className={styles.errorLink}>
                Sign in
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
