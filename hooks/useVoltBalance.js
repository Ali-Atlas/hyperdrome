'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/hooks/useSession';

/**
 * The player's Volts balance for display: the session's `points` (the database cache of
 * `ft_balance_of`, SPEC.md 7). A `volts:update` event's `detail.balance` (a mutation response's
 * fresher value) shows until the session's points change, which happens when the session is
 * re-read after the action.
 * @returns {{ balance: number, loading: boolean }}
 */
export function useVoltBalance() {
  const { user, status } = useSession();
  const points = user?.points ?? null;
  const pointsRef = useRef(points);
  const [override, setOverride] = useState(
    /** @type {{ balance: number, points: number | null } | null} */ (null)
  );

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    /** @param {Event} e */
    function onUpdate(e) {
      const balance = Number(/** @type {CustomEvent} */ (e).detail?.balance);
      if (Number.isFinite(balance)) setOverride({ balance, points: pointsRef.current });
    }
    window.addEventListener('volts:update', onUpdate);
    return () => window.removeEventListener('volts:update', onUpdate);
  }, []);

  const balance = override && override.points === points ? override.balance : (points ?? 0);
  return { balance, loading: status === 'loading' };
}
