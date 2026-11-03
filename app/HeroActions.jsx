'use client';

import { usePlayDemo } from '@/hooks/usePlayDemo';
import styles from './HeroActions.module.css';

/**
 * Hero primary CTA: Play Demo signs in a fresh demo account and goes to /dashboard, where the
 * on-chain bootstrap runs. Google sign-in is the top-right link (`app/HeroSignIn.jsx`).
 *
 * Background audio for the hero is owned by `app/HeroAudio.jsx`
 * (landing page only); no audio runs inside the app shell.
 */
export default function HeroActions() {
  const { start, loading, error } = usePlayDemo();

  return (
    <div className={styles.cluster}>
      <button type="button" onClick={start} disabled={loading} className={styles.primary}>
        {loading ? 'Loading...' : 'Play Demo'}
      </button>
      {error && (
        <p role="alert" className={styles.errorText}>
          {error}
        </p>
      )}
    </div>
  );
}
