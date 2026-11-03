'use client';

import { useEffect, useState } from 'react';
import { useSession } from '@/hooks/useSession';

/**
 * The player's Volts balance for display. Starts from the session's `points` (the database cache
 * of `ft_balance_of`, SPEC.md 7) and takes the latest `volts:update` event's `detail.balance`
 * when a mutation response carries a fresher value.
 * @returns {{ balance: number, loading: boolean }}
 */
export function useVoltBalance() {
  const { user, status } = useSession();
  const [override, setOverride] = useState(/** @type {number | null} */ (null));

  useEffect(() => {
    /** @param {Event} e */
    function onUpdate(e) {
      const balance = Number(/** @type {CustomEvent} */ (e).detail?.balance);
      if (Number.isFinite(balance)) setOverride(balance);
    }
    window.addEventListener('volts:update', onUpdate);
    return () => window.removeEventListener('volts:update', onUpdate);
  }, []);

  return { balance: override ?? user?.points ?? 0, loading: status === 'loading' };
}
