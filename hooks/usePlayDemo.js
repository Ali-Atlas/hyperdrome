'use client';

import { useState } from 'react';

/**
 * Play Demo (SPEC.md 12): POST /api/auth/demo signs in a fresh `PILOT_` user, then the browser
 * goes to the dashboard, which runs the on-chain bootstrap. Used by the landing hero and /login.
 * @returns {{ start: () => Promise<void>, loading: boolean, error: string | null }}
 */
export function usePlayDemo() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));

  async function start() {
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

  return { start, loading, error };
}
