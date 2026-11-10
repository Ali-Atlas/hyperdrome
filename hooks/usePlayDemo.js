'use client';

import { useState } from 'react';

/**
 * Play Demo (SPEC.md 12): POST /api/auth/demo signs in a fresh `PILOT_` user, then the browser
 * goes to the dashboard, which runs the on-chain bootstrap. Used by the landing hero and /login.
 * `limited` is true after a 429 (the demo cap or the per-IP limit), so the caller can offer Google.
 * @returns {{ start: () => Promise<void>, loading: boolean, error: string | null, limited: boolean }}
 */
export function usePlayDemo() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [limited, setLimited] = useState(false);

  async function start() {
    if (loading) return;
    setLoading(true);
    setError(null);
    setLimited(false);
    try {
      const res = await fetch('/api/auth/demo', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not start demo. Try again.');
        setLimited(res.status === 429);
        setLoading(false);
        return;
      }
      window.location.href = data.redirectUrl || '/dashboard';
    } catch {
      setError('Network error. Try again.');
      setLoading(false);
    }
  }

  return { start, loading, error, limited };
}
