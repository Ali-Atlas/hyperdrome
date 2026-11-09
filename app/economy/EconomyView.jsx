'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ExternalLink } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Skeleton from '@/components/ui/Skeleton';
import VoltIcon from '@/components/ui/VoltIcon';
import { flowSeries, stepHour, teamVoltSeries } from '@/lib/economy/series.js';
import EconomyChart from './EconomyChart.jsx';
import styles from './page.module.css';

/** The route's cache lifetime. */
const REFRESH_MS = 30_000;
/** The replay plays the recorded window in this long. */
const REPLAY_MS = 60_000;
/** Decisions shown per team card. */
const TEAM_DECISIONS = 4;

/**
 * @typedef {import('@/lib/economy/series.js').Snapshot} Snapshot
 * @typedef {{ actionId: string, team: string | null, step: string, status: string, reason: string, explorerUrl: string | null, at: string }} Decision
 * @typedef {object} Economy
 * @property {{ slug: string, name: string, accountUrl: string }[]} teams
 * @property {Snapshot[]} snapshots
 * @property {Decision[]} decisions
 * @property {{ step: string, name: string, description: string }[]} rules
 * @property {{ reserve: number, perTxCap: number, perDayCap: number }} limits
 * @property {string | null} since
 * @property {string} contractUrl
 */

const number = new Intl.NumberFormat('en-US');
/** @param {number | null | undefined} v */
const fmt = (v) => (v === null || v === undefined ? '-' : number.format(v));
/** @param {string} iso */
const clock = (iso) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
/** @param {string} iso */
const longDate = (iso) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
/** @param {() => void} onChange */
function subscribeMotion(onChange) {
  const query = window.matchMedia(MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const prefersReducedMotion = () => window.matchMedia(MOTION_QUERY).matches;

/** What a decision's status reads as; an applied one shows none. */
const STATUS_LABEL = /** @type {Record<string, string>} */ ({
  pending: 'Confirming',
  refused: 'Refused',
  error: 'Failed',
});

/**
 * The economy page: live numbers, one card per AI team, minted against burned, the replay and the
 * teams' rules, from `GET /api/economy`.
 */
export default function EconomyView() {
  const [data, setData] = useState(/** @type {Economy | null} */ (null));
  const [failed, setFailed] = useState(false);
  /** null: now; a number: the snapshot the replay or the step-through is on */
  const [cursor, setCursor] = useState(/** @type {number | null} */ (null));
  const [mode, setMode] = useState(/** @type {'live' | 'playing' | 'stepping'} */ ('live'));
  const reducedMotion = useSyncExternalStore(subscribeMotion, prefersReducedMotion, () => false);
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const scrolled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // A replay holds the data it started with, so its indexes stay put.
      if (modeRef.current !== 'live') return;
      try {
        const res = await fetch('/api/economy');
        const body = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setData(body.data);
          setFailed(false);
        } else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // A link to /economy#<team> lands on the card once the cards exist.
  useEffect(() => {
    if (!data || scrolled.current) return;
    scrolled.current = true;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, [data]);

  const count = data?.snapshots.length ?? 0;

  useEffect(() => {
    if (mode !== 'playing' || count < 2) return;
    const start = performance.now();
    let frame = 0;
    const tick = (/** @type {number} */ now) => {
      const p = Math.min(1, (now - start) / REPLAY_MS);
      setCursor(Math.round(p * (count - 1)));
      if (p < 1) frame = requestAnimationFrame(tick);
      else {
        setMode('live');
        setCursor(null);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mode, count]);

  if (!data) {
    return failed ? (
      <Card className={styles.section}>
        <p className={styles.text}>Economy data is unavailable. Try again in a minute.</p>
      </Card>
    ) : (
      <div className={styles.loading}>
        <Skeleton variant="card" height={96} />
        <Skeleton variant="card" height={240} count={2} />
      </div>
    );
  }

  const { snapshots, decisions, teams, rules, limits, since, contractUrl } = data;
  const visible = cursor === null ? count : cursor + 1;
  const current = count > 0 ? snapshots[visible - 1] : null;
  const shownDecisions = current
    ? decisions.filter((d) => cursor === null || Date.parse(d.at) <= Date.parse(current.at))
    : decisions;
  const times = snapshots.map((s) => s.at);
  const flows = flowSeries(snapshots);
  const stopReplay = () => {
    setMode('live');
    setCursor(null);
  };

  return (
    <div className={styles.sections}>
      <p className={styles.history}>
        {since
          ? `History starts on ${longDate(since)}, when this page launched. It is recorded every tick and kept for 7 days.`
          : 'History starts when this page launches. It is recorded every tick and kept for 7 days.'}
      </p>

      <Card className={styles.section}>
        <div className={styles.numbers}>
          <Figure label="Volt supply" value={current?.supply} volts />
          <Figure label="Minted today" value={current?.minted} volts />
          <Figure label="Burned today" value={current?.burned} volts />
          <Figure label="Trades today" value={current?.trades} />
        </div>
        <div className={styles.replay}>
          {mode === 'live' &&
            (reducedMotion ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={count < 2}
                onClick={() => {
                  setCursor(0);
                  setMode('stepping');
                }}
              >
                Step through the last 24 hours
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled={count < 2}
                onClick={() => {
                  setCursor(0);
                  setMode('playing');
                }}
              >
                Replay the last 24 hours in 60 seconds
              </Button>
            ))}
          {mode === 'playing' && (
            <>
              <span className={styles.replayTime}>
                Replaying {current ? clock(current.at) : ''}
              </span>
              <Button variant="ghost" size="sm" onClick={stopReplay}>
                Stop
              </Button>
            </>
          )}
          {mode === 'stepping' && cursor !== null && (
            <>
              <span className={styles.replayTime} aria-live="polite">
                Showing {current ? clock(current.at) : ''}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={cursor === 0}
                onClick={() => setCursor(stepHour(snapshots, cursor, -1))}
              >
                Previous hour
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={cursor === count - 1}
                onClick={() => setCursor(stepHour(snapshots, cursor, 1))}
              >
                Next hour
              </Button>
              <Button variant="ghost" size="sm" onClick={stopReplay}>
                Back to now
              </Button>
            </>
          )}
          {mode === 'live' && count < 2 && (
            <span className={styles.replayTime}>
              The replay starts once a few ticks are recorded.
            </span>
          )}
        </div>
      </Card>

      <div className={styles.teams}>
        {teams.map((team) => {
          const row = current?.teams.find((t) => t.slug === team.slug);
          const own = shownDecisions.filter((d) => d.team === team.slug).slice(0, TEAM_DECISIONS);
          return (
            <Card key={team.slug} id={team.slug} className={styles.teamCard}>
              <div className={styles.teamHead}>
                <h2 className={styles.teamName}>{team.name}</h2>
                <a
                  href={team.accountUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.link}
                >
                  Account <ExternalLink size={12} aria-hidden="true" />
                </a>
              </div>
              <div className={styles.teamFigures}>
                <Figure label="Volts" value={row?.volts} volts />
                <Figure label="Drones" value={row?.drones} />
                <Figure label="Listings" value={row?.openListings} />
              </div>
              <EconomyChart
                series={[
                  {
                    label: 'Volts',
                    color: 'var(--accent-primary)',
                    values: teamVoltSeries(snapshots, team.slug),
                  },
                ]}
                times={times}
                visible={visible}
                label={`${team.name} Volts over the last 24 hours`}
                area
              />
              <h3 className={styles.feedHeading}>Latest decisions</h3>
              {own.length === 0 ? (
                <p className={styles.textMuted}>No decisions recorded for this time.</p>
              ) : (
                <ul className={styles.feed}>
                  {own.map((d) => (
                    <li key={d.actionId} className={styles.decision}>
                      <span className={styles.decisionTime}>{clock(d.at)}</span>
                      <span className={styles.decisionReason}>
                        {d.reason}
                        {STATUS_LABEL[d.status] && (
                          <span className={styles.decisionStatus}> {STATUS_LABEL[d.status]}</span>
                        )}
                      </span>
                      {d.explorerUrl && (
                        <a
                          href={d.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.link}
                          aria-label={`Transaction for: ${d.reason}`}
                        >
                          Tx <ExternalLink size={12} aria-hidden="true" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      <Card className={styles.section}>
        <h2 className={styles.sectionHeading}>Minted and burned, last 24 hours</h2>
        <p className={styles.textMuted}>
          Volts added up from the start of the window. Races, level-ups and grants mint Volts.
          Upgrades, packs, capsules and vendor drones burn them.
        </p>
        <EconomyChart
          series={[
            { label: 'Minted', color: 'var(--accent-primary)', values: flows.minted },
            { label: 'Burned', color: 'var(--accent-error)', values: flows.burned },
          ]}
          times={times}
          visible={visible}
          label="Volts minted and burned over the last 24 hours"
          fromZero
          legend
        />
      </Card>

      <Card className={styles.section}>
        <h2 className={styles.sectionHeading}>How the teams decide</h2>
        <p className={styles.text}>
          Every 3 minutes each team takes at most one action: the first of these steps that applies.
          A team never spends below its reserve of {fmt(limits.reserve)} Volts. The{' '}
          <a href={contractUrl} target="_blank" rel="noopener noreferrer" className={styles.link}>
            game contract
          </a>{' '}
          caps its spending at {fmt(limits.perTxCap)} Volts per transaction and{' '}
          {fmt(limits.perDayCap)} a day.
        </p>
        <ol className={styles.rules}>
          {rules.map((rule) => (
            <li key={rule.step}>
              <span className={styles.ruleName}>{rule.name}.</span> {rule.description}
            </li>
          ))}
        </ol>
        <p className={styles.textMuted}>
          Fit is how much a mod helps in one race. Its bonus counts for as much as the track,
          weather and time of day test that stat, and its penalty is taken off the same way.
        </p>
      </Card>
    </div>
  );
}

/**
 * @param {{ label: string, value: number | null | undefined, volts?: boolean }} props
 */
function Figure({ label, value, volts = false }) {
  return (
    <div className={styles.number}>
      <span className={styles.numberLabel}>{label}</span>
      <span className={styles.numberValue}>
        {volts && <VoltIcon size={14} />}
        {fmt(value)}
      </span>
    </div>
  );
}
