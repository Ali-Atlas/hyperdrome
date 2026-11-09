'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import CountdownTimer from '@/components/ui/CountdownTimer';
import VoltIcon from '@/components/ui/VoltIcon';
import styles from './LiveStrip.module.css';

/** Re-read at the route's cache lifetime. */
const REFRESH_MS = 30_000;

/**
 * @typedef {object} LiveData
 * @property {{ paused: boolean, nextRaceAt: string }} nextRace
 * @property {{ results: { winner: string, loser: string, marginMs: number | null }[] } | null} lastBatch
 * @property {{ voltsMinted: number, voltsBurned: number, trades: number }} today
 * @property {string} contractUrl
 */

/** @param {number | null} ms */
const formatMargin = (ms) => (ms === null ? '' : `+${(ms / 1000).toFixed(3)}s`);

/**
 * The hero's live strip: next race, the last batch's results, today's Volts and trades, and the
 * contract on the explorer. It renders nothing until the data arrives and if the read fails, so
 * the hero never waits on it.
 */
export default function LiveStrip() {
  const [live, setLive] = useState(/** @type {LiveData | null} */ (null));

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/live');
        const body = await res.json();
        if (!cancelled && res.ok) setLive(body.data);
      } catch {
        // The strip is decoration on the hero: the last good data stays, or nothing shows.
      }
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!live) return null;
  const { nextRace, lastBatch, today, contractUrl } = live;

  return (
    <aside className={styles.strip} aria-label="Live race data">
      <div className={styles.row}>
        {nextRace.paused ? (
          <span className={styles.value}>Racing paused</span>
        ) : (
          <CountdownTimer
            className={styles.timer}
            targetDate={nextRace.nextRaceAt}
            label="Next race"
            expiredLabel="Racing now..."
          />
        )}
        <Stat label="Minted today" value={today.voltsMinted} volts />
        <Stat label="Burned today" value={today.voltsBurned} volts />
        <Stat label="Trades today" value={today.trades} />
        <a href={contractUrl} target="_blank" rel="noopener noreferrer" className={styles.contract}>
          Contract <ExternalLink size={12} aria-hidden="true" />
        </a>
        <Link href="/economy" className={styles.contract}>
          Watch the economy
        </Link>
      </div>
      {lastBatch && lastBatch.results.length > 0 && (
        <ul className={styles.results} aria-label="Last race results">
          {lastBatch.results.map((r) => (
            <li key={`${r.winner}-${r.loser}`} className={styles.result}>
              <span className={styles.winner}>{r.winner}</span> beat {r.loser}{' '}
              <span className={styles.margin}>{formatMargin(r.marginMs)}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

/**
 * @param {{ label: string, value: number, volts?: boolean }} props
 */
function Stat({ label, value, volts = false }) {
  return (
    <span className={styles.stat}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>
        {volts && <VoltIcon size={12} />}
        {value.toLocaleString()}
      </span>
    </span>
  );
}
