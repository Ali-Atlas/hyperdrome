'use client';

import { useCallback } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/hooks/useSession';
import { PENDING_MESSAGE, postChainAction } from '@/lib/client/chain-action';

/**
 * A page's `send(url, body)` for chain mutations: `postChainAction` with the pending toast, then
 * on a 200 the new balance (`volts`) goes out as a `volts:update` event and the session is
 * re-read so `users.points` (SPEC.md 7) reaches NavShell.
 * @returns {(url: string, body: Record<string, unknown>) => Promise<import('@/lib/client/chain-action').ActionResult>}
 */
export function useChainAction() {
  const { showToast } = useToast();
  const { update } = useSession();
  return useCallback(
    async (url, body) => {
      const result = await postChainAction(url, body, {
        onPending: () => showToast(PENDING_MESSAGE, 'info'),
      });
      if (result.ok) {
        if (typeof result.body.volts === 'number') {
          window.dispatchEvent(
            new CustomEvent('volts:update', { detail: { balance: result.body.volts } })
          );
        }
        update().catch(() => {});
      }
      return result;
    },
    [showToast, update]
  );
}
