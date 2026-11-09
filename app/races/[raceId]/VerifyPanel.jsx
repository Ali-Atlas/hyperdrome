'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { verifyRaceOnChain } from '@/lib/client/race-verify.js';
import { PUBLIC_EXPLORER_URL, explorerTxUrl } from '@/lib/near/explorer.js';
import { cn } from '@/lib/utils';
import pageStyles from './page.module.css';
import styles from './VerifyPanel.module.css';

/**
 * Re-checks a settled race in the browser, from the chain's own transactions (SPEC.md 11).
 * @param {{ race: any }} props the `GET /api/races/[id]` body
 */
export default function VerifyPanel({ race }) {
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState(
    /** @type {import('@/lib/client/race-verify.js').CheckLine[] | null} */ (null)
  );
  const [error, setError] = useState(/** @type {string | null} */ (null));

  async function verify() {
    setRunning(true);
    setError(null);
    setLines(null);
    try {
      setLines(await verifyRaceOnChain(race));
    } catch (err) {
      setError(`${err instanceof Error ? err.message : 'The check did not finish'}. Try again.`);
    } finally {
      setRunning(false);
    }
  }

  const passed = lines?.every((line) => line.pass);

  return (
    <Card>
      <h2 className={pageStyles.sectionHeading}>Verify</h2>
      <div className={styles.body}>
        <div className={styles.intro}>
          <p className={styles.text}>
            Reads this race&apos;s transactions from a public NEAR RPC in your browser, then runs
            the race again from the revealed seed.
          </p>
          <Button variant="secondary" size="sm" loading={running} onClick={verify}>
            Verify
          </Button>
        </div>
        <div aria-live="polite">
          {error && <p className={styles.error}>{error}</p>}
          {lines && (
            <>
              <p className={cn(styles.summary, passed ? styles.pass : styles.fail)}>
                {passed ? 'All checks passed' : 'A check failed'}
              </p>
              <ul className={styles.lines}>
                {lines.map((line) => (
                  <li key={line.key} className={styles.line}>
                    <span className={cn(styles.result, line.pass ? styles.pass : styles.fail)}>
                      {line.pass ? 'Pass' : 'Fail'}
                    </span>
                    <span className={styles.label}>
                      {line.label}
                      <span className={styles.detail}>{line.detail}</span>
                    </span>
                    <a
                      className={styles.link}
                      href={explorerTxUrl(PUBLIC_EXPLORER_URL, line.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Transaction
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
