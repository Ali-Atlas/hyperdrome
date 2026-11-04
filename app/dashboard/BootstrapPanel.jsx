'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/hooks/useSession';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import styles from './BootstrapPanel.module.css';

/** What each bootstrap state is waiting on (SPEC.md 12). */
const STEP_LABEL = {
  none: 'Creating your NEAR account',
  account: 'Minting your starter drone, Ember skin, mod and 1,000 Volts',
  minted: 'Binding the skin and mod to your drone',
  done: 'Starter kit ready',
};

/** Wait before calling again while another request holds the bootstrap or an outcome is unknown. */
const RETRY_MS = 3000;

/**
 * Calls POST /api/auth/bootstrap (one step per call) until the player's account and starter kit
 * exist on chain: again at once after a step, after RETRY_MS while busy or pending. Shows
 * progress and the explorer link, then reloads the dashboard. Mounted while bootstrap is not done.
 */
export default function BootstrapPanel() {
  const { update } = useSession();
  const [status, setStatus] = useState(
    /** @type {{ state: string, explorerUrl?: string | null, error?: string }} */ ({
      state: 'none',
    })
  );
  const [attempt, setAttempt] = useState(0);
  const timer = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/bootstrap', { method: 'POST' });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 200 && body.state === 'done') {
          setStatus(body);
          await update();
          window.location.reload();
          return;
        }
        if (res.status === 202) {
          setStatus((prev) => ({ ...prev, ...body, error: undefined }));
          const wait = body.busy || body.pending ? RETRY_MS : 0;
          timer.current = setTimeout(() => setAttempt((n) => n + 1), wait);
          return;
        }
        setStatus((prev) => ({ ...prev, error: body.error ?? 'Setup failed. Try again.' }));
      } catch {
        if (!cancelled) setStatus((prev) => ({ ...prev, error: 'Network error. Try again.' }));
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer.current);
    };
  }, [attempt, update]);

  const label =
    STEP_LABEL[/** @type {keyof typeof STEP_LABEL} */ (status.state)] ?? STEP_LABEL.none;
  return (
    <section className={styles.panel} role="status" aria-live="polite">
      <div className={styles.row}>
        {!status.error && <Spinner />}
        <div>
          <h2 className={styles.title}>Setting up your pilot account</h2>
          <p className={styles.step}>{status.error ?? `${label}...`}</p>
        </div>
      </div>
      {status.explorerUrl && (
        <a
          href={status.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.link}
        >
          View your account on NearBlocks
        </a>
      )}
      {status.error && (
        <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </Button>
      )}
    </section>
  );
}
