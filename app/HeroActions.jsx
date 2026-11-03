'use client';

import { useState } from 'react';
import styles from './HeroActions.module.css';

/**
 * Hero primary CTA. Single PLAY DEMO button - opens a pre-seeded off-chain
 * account and redirects to /dashboard. The CONNECT WALLET secondary entry
 * point lives in the top-right corner of the landing page (see
 * `app/HeroConnectWallet.jsx`), keeping the hero center focused on the
 * primary action.
 *
 * Background audio for the hero is owned by `app/HeroAudio.jsx`
 * (landing page only); no audio runs inside the app shell.
 */
export default function HeroActions() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleDemo() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/demo', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not start demo. Try again.');
        setLoading(false);
        return;
      }
      window.location.href = data.redirectUrl || '/dashboard';
    } catch {
      setError('Network error. Try again.');
      setLoading(false);
    }
  }

  return (
    <div className={styles.cluster}>
      <button type="button" onClick={handleDemo} disabled={loading} className={styles.primary}>
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
