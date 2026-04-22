'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import btnStyles from '@/components/ui/Button/Button.module.css';
import { cn, getLevelColor } from '@/lib/utils';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useSession } from '@/hooks/useSession';
import styles from './page.module.css';

const SPOTLIGHT_STATS = [
  ['speed', 'SPEED'],
  ['turning', 'TURNING'],
  ['acceleration', 'ACCELERATION'],
  ['durability', 'DURABILITY'],
  ['nightVision', 'NIGHT VISION'],
  ['batteryCapacity', 'BATTERY'],
  ['rainHandling', 'RAIN HANDLING'],
  ['windResistance', 'WIND RESISTANCE'],
  ['consistency', 'CONSISTENCY'],
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function DashboardPage() {
  const { user } = useSession();
  const [myDrones, setMyDrones] = useState([]);
  const [spotlightIndex, setSpotlightIndex] = useState(0);
  const [liveFeed, setLiveFeed] = useState([]);
  const [nextRaceAt, setNextRaceAt] = useState(null);
  const [racingPaused, setRacingPaused] = useState(false);
  const [myStats, setMyStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [dronesRes, racesRes, nextRes, meRes] = await Promise.all([
        fetch('/api/drones').then((r) => r.json()).catch(() => null),
        fetch('/api/races?limit=20').then((r) => r.json()).catch(() => null),
        fetch('/api/races/next').then((r) => r.json()).catch(() => null),
        fetch('/api/leaderboard/me').then((r) => r.json()).catch(() => null),
      ]);
      if (dronesRes?.data) setMyDrones(dronesRes.data);
      if (racesRes?.data?.items) setLiveFeed(racesRes.data.items.slice(0, 10));
      if (nextRes?.data) {
        setRacingPaused(Boolean(nextRes.data.paused));
        setNextRaceAt(nextRes.data.nextRaceAt ?? null);
      }
      if (meRes?.data) setMyStats(meRes.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  const recentRaces = useMemo(() => {
    if (!myDrones.length) return [];
    const myDroneIds = new Set(myDrones.map((d) => d.id));
    return liveFeed
      .filter(
        (r) => myDroneIds.has(r.drone1Id) || myDroneIds.has(r.drone2Id),
      )
      .slice(0, 10);
  }, [liveFeed, myDrones]);

  const activeDrones = useMemo(
    () => myDrones.filter((d) => d.active),
    [myDrones],
  );

  useEffect(() => {
    if (activeDrones.length === 0) {
      setSpotlightIndex(0);
    } else if (spotlightIndex >= activeDrones.length) {
      setSpotlightIndex(0);
    }
  }, [activeDrones.length, spotlightIndex]);

  const spotlightDrone = activeDrones[spotlightIndex] ?? null;
  const canCycle = activeDrones.length > 1;

  const goPrev = () =>
    setSpotlightIndex(
      (i) => (i - 1 + activeDrones.length) % activeDrones.length,
    );
  const goNext = () =>
    setSpotlightIndex((i) => (i + 1) % activeDrones.length);

  const userWinRate = myStats?.totalRaces
    ? ((myStats.totalWins / myStats.totalRaces) * 100).toFixed(1) + '%'
    : '—';

  const currentStreak = useMemo(() => {
    if (!recentRaces.length || !myDrones.length) return '—';
    const myDroneIds = new Set(myDrones.map((d) => d.id));
    let streak = 0;
    for (const race of recentRaces) {
      const didWin = myDroneIds.has(race.winnerDroneId);
      if (streak === 0) {
        streak = didWin ? 1 : -1;
      } else if ((streak > 0 && didWin) || (streak < 0 && !didWin)) {
        streak += streak > 0 ? 1 : -1;
      } else {
        break;
      }
    }
    if (streak === 0) return '—';
    return `${streak > 0 ? 'W' : 'L'}${Math.abs(streak)}`;
  }, [recentRaces, myDrones]);

  const droneWinRate =
    spotlightDrone && spotlightDrone.totalRaces > 0
      ? ((spotlightDrone.wins / spotlightDrone.totalRaces) * 100).toFixed(1) +
        '%'
      : '—';

  return (
    <NavShell>
      <div className={styles.page}>
        <div className={styles.grid}>
          {/* ---- Row 1 col 1: Spotlight ---- */}
          <Card className={cn(styles.spotlight, styles.areaSpotlight)}>
            <div className={styles.sectionHeadingRow}>
              <h2 className={styles.sectionHeading}>
                Active Drone Spotlight
              </h2>
              {canCycle && (
                <div className={styles.navCluster}>
                  <button
                    type="button"
                    className={styles.navBtn}
                    onClick={goPrev}
                    aria-label="Previous drone"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className={styles.navCounter}>
                    {spotlightIndex + 1}/{activeDrones.length}
                  </span>
                  <button
                    type="button"
                    className={styles.navBtn}
                    onClick={goNext}
                    aria-label="Next drone"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </div>

            {loading ? (
              <div className={styles.cardBody}>
                <Skeleton variant="card" height={220} />
              </div>
            ) : spotlightDrone ? (
              <div className={styles.spotlightBody}>
                <div className={styles.spotlightLeft}>
                  <div className={styles.droneNameBlock}>
                    <span className={styles.droneName}>
                      {spotlightDrone.name}
                    </span>
                    <span
                      className={styles.droneLevel}
                      style={{
                        color: getLevelColor(spotlightDrone.level),
                      }}
                    >
                      Level {spotlightDrone.level}
                    </span>
                  </div>
                  <div className={styles.spotlightImage}>
                    <img
                      src={spotlightDrone.imageUrl || '/drones/default.png'}
                      alt={spotlightDrone.name}
                    />
                  </div>
                  <dl className={styles.spotlightKpiGrid}>
                    <div className={styles.kpiCell}>
                      <dt>Races</dt>
                      <dd>{spotlightDrone.totalRaces}</dd>
                    </div>
                    <div className={styles.kpiCell}>
                      <dt>Win Rate</dt>
                      <dd>{droneWinRate}</dd>
                    </div>
                    <div className={styles.kpiCell}>
                      <dt>Record</dt>
                      <dd>
                        {spotlightDrone.wins}W / {spotlightDrone.losses}L
                      </dd>
                    </div>
                    <div className={styles.kpiCell}>
                      <dt>ELO</dt>
                      <dd>{spotlightDrone.eloRating}</dd>
                    </div>
                  </dl>
                </div>

                <div className={styles.spotlightRight}>
                  <div className={styles.spotlightStats}>
                    {SPOTLIGHT_STATS.map(([key, label]) => (
                      <StatRow
                        key={key}
                        label={label}
                        value={spotlightDrone[key] ?? 0}
                      />
                    ))}
                  </div>
                  <Link
                    href={`/drones/${spotlightDrone.id}`}
                    className={cn(
                      btnStyles.button,
                      btnStyles.primary,
                      btnStyles.sm,
                      styles.manageBtn,
                    )}
                  >
                    Manage Drone
                  </Link>
                </div>
              </div>
            ) : (
              <div className={styles.cardBody}>
                <EmptyState
                  title="No active drone"
                  description="Activate a drone from My Drones to enter the next race."
                  actionLabel="Go to My Drones"
                  onAction={() => window.location.assign('/drones')}
                />
              </div>
            )}
          </Card>

          {/* ---- Row 1 col 2: Live Race Feed ---- */}
          <Card className={cn(styles.liveFeed, styles.areaFeed)}>
            <h2 className={styles.sectionHeading}>Live Race Feed</h2>
            <div className={cn(styles.cardBody, styles.feedBody)}>
            <div className={styles.feedList}>
              {loading ? (
                <Skeleton variant="text" count={6} />
              ) : liveFeed.length === 0 ? (
                <p className={styles.empty}>No recent races.</p>
              ) : (
                liveFeed.map((r) => {
                  const winner =
                    r.winnerDroneId === r.drone1Id ? r.drone1 : r.drone2;
                  const loser =
                    r.winnerDroneId === r.drone1Id ? r.drone2 : r.drone1;
                  const ts = new Date(r.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  });
                  return (
                    <Link
                      key={r.id}
                      href={`/races/${r.id}`}
                      className={styles.feedRow}
                    >
                      <span className={styles.feedTime}>{ts}</span>
                      <span className={styles.feedSep}>|</span>
                      <span className={styles.feedDrone}>
                        {winner?.name ?? '—'}
                      </span>
                      <span className={styles.feedWord}>beat</span>
                      <span className={styles.feedDrone}>
                        {loser?.name ?? '—'}
                      </span>
                      <span className={styles.feedWord}>on</span>
                      <span className={styles.feedTrack}>
                        {r.track?.name ?? '—'}
                      </span>
                    </Link>
                  );
                })
              )}
            </div>
            </div>
          </Card>

          {/* ---- Row 2 col 1: Recent Results ---- */}
          <Card className={cn(styles.results, styles.areaResults)}>
            <h2 className={styles.sectionHeading}>Your Recent Results</h2>
            <div className={styles.cardBody}>
            {loading ? (
              <Skeleton variant="text" count={5} />
            ) : recentRaces.length === 0 ? (
              <p className={styles.empty}>
                No races yet. Activate a drone and wait for the next race
                block.
              </p>
            ) : (
              <div className={styles.resultsTable}>
                <div className={styles.resultsHeader}>
                  <span>Opponent</span>
                  <span>Track</span>
                  <span>Result</span>
                  <span className={styles.alignRight}>Points Earned</span>
                </div>
                {recentRaces.map((r) => {
                  const myDroneIds = new Set(myDrones.map((d) => d.id));
                  const opp = myDroneIds.has(r.drone1Id)
                    ? r.drone2
                    : r.drone1;
                  const won = myDroneIds.has(r.winnerDroneId);
                  return (
                    <Link
                      key={r.id}
                      href={`/races/${r.id}`}
                      className={styles.resultsRow}
                    >
                      <span>{opp?.name ?? '—'}</span>
                      <span>{r.track?.name ?? '—'}</span>
                      <span>
                        {won ? (
                          <span className={styles.resultWin}>WIN</span>
                        ) : (
                          <span className={styles.resultLossPill}>LOSS</span>
                        )}
                      </span>
                      <span
                        className={`${styles.mono} ${styles.alignRight}`}
                      >
                        {won ? `+${r.pointsAwarded}` : '—'}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
            </div>
          </Card>

          {/* ---- Row 2 col 2: Countdown ---- */}
          <Card className={cn(styles.countdownCard, styles.areaCountdown)}>
            <h2 className={styles.sectionHeading}>Next Race Countdown</h2>
            <div className={styles.cardBody}>
              <NextRaceCountdown
                targetDate={nextRaceAt}
                paused={racingPaused}
              />
            </div>
          </Card>

          {/* ---- Row 3 col 2: Quick Stats ---- */}
          <Card className={cn(styles.quickStatsCard, styles.areaQuickStats)}>
            <h2 className={styles.sectionHeading}>Quick Stats</h2>
            <div className={styles.cardBody}>
            <div className={styles.quickStatsRow}>
              <QuickStat
                label="Total Races"
                value={myStats?.totalRaces ?? 0}
              />
              <QuickStat label="Win Rate" value={userWinRate} />
              <QuickStat label="Streak" value={currentStreak} />
              <QuickStat
                label="Season Rank"
                value={myStats?.rank ? `#${myStats.rank}` : '—'}
              />
            </div>
            </div>
          </Card>
        </div>
      </div>
    </NavShell>
  );
}

function StatRow({ label, value, max = 100 }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={styles.statRow}>
      <span className={styles.statRowLabel}>{label}</span>
      <div className={styles.statBarTrack}>
        <div
          className={styles.statBarFill}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

function QuickStat({ label, value }) {
  return (
    <div className={styles.quickItem}>
      <span className={styles.quickLabel}>{label}</span>
      <span className={styles.quickValue}>
        <span className={styles.quickBracket}>[</span>
        <span className={styles.quickValueInner}>{value}</span>
        <span className={styles.quickBracket}>]</span>
      </span>
    </div>
  );
}

function NextRaceCountdown({ targetDate, paused }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused || !targetDate) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [paused, targetDate]);

  const remaining = targetDate
    ? Math.max(0, new Date(targetDate).getTime() - now)
    : 0;
  const total = Math.floor(remaining / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n) => String(n).padStart(2, '0');

  return (
    <>
      <div
        className={cn(
          styles.countdownClock,
          paused && styles.countdownClockPaused,
        )}
      >
        <div className={styles.countdownGroup}>
          <span className={styles.countdownUnit}>{pad(days)}</span>
          <span className={styles.countdownLabel}>DD</span>
        </div>
        <span className={styles.countdownColon}>:</span>
        <div className={styles.countdownGroup}>
          <span className={styles.countdownUnit}>{pad(hours)}</span>
          <span className={styles.countdownLabel}>HH</span>
        </div>
        <span className={styles.countdownColon}>:</span>
        <div className={styles.countdownGroup}>
          <span className={styles.countdownUnit}>{pad(mins)}</span>
          <span className={styles.countdownLabel}>MM</span>
        </div>
        <span className={styles.countdownColon}>:</span>
        <div className={styles.countdownGroup}>
          <span className={styles.countdownUnit}>{pad(secs)}</span>
          <span className={styles.countdownLabel}>SS</span>
        </div>
      </div>
      <div className={styles.countdownTagline}>
        {paused ? 'Racing Paused' : 'Seconds Until Race'}
      </div>
    </>
  );
}
