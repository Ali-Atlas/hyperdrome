'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import btnStyles from '@/components/ui/Button/Button.module.css';
import { cn } from '@/lib/utils';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useSession } from '@/hooks/useSession';
import styles from './page.module.css';

const SPOTLIGHT_STATS = [
  ['speed', 'SPD'],
  ['turning', 'TRN'],
  ['acceleration', 'ACC'],
  ['durability', 'DUR'],
  ['nightVision', 'N.VIS'],
  ['batteryCapacity', 'BAT'],
  ['rainHandling', 'RAIN'],
  ['windResistance', 'WIND'],
  ['consistency', 'CON'],
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
        <header className={styles.welcome}>
          <h1 className={styles.hello}>
            {user?.username ?? 'Player'}
          </h1>
          <div className={styles.welcomeMeta}>
            <span className={styles.points}>
              <span className={styles.pointsLabel}>Points</span>
              <span className={styles.pointsValue}>
                {(myStats?.points ?? user?.points ?? 0).toLocaleString()}
              </span>
            </span>
          </div>
        </header>

        <div className={styles.grid}>
          {/* ---- LEFT COLUMN ---- */}
          <div className={styles.leftCol}>
            <Card className={styles.spotlight}>
              <div className={styles.spotlightHeader}>
                <span className={styles.spotlightLabel}>
                  Active Drone Spotlight
                </span>
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
                <Skeleton variant="card" height={220} />
              ) : spotlightDrone ? (
                <>
                  <div className={styles.spotlightBody}>
                    <div className={styles.spotlightImage}>
                      <img
                        src={spotlightDrone.imageUrl || '/drones/default.png'}
                        alt={spotlightDrone.name}
                      />
                    </div>
                    <div className={styles.spotlightStats}>
                      {SPOTLIGHT_STATS.map(([key, label]) => (
                        <StatRow
                          key={key}
                          label={label}
                          value={spotlightDrone[key] ?? 0}
                        />
                      ))}
                    </div>
                  </div>
                  <div className={styles.spotlightFooter}>
                    <div className={styles.spotlightNameBlock}>
                      <span className={styles.spotlightDroneName}>
                        {spotlightDrone.name}
                      </span>
                      <Badge variant="level" value={spotlightDrone.level} />
                    </div>
                    <Link
                      href={`/drones/${spotlightDrone.id}`}
                      className={cn(
                        btnStyles.button,
                        btnStyles.primary,
                        btnStyles.sm,
                      )}
                    >
                      Manage Drone
                    </Link>
                  </div>
                </>
              ) : (
                <EmptyState
                  title="No active drone"
                  description="Activate a drone from My Drones to enter the next race."
                  actionLabel="Go to My Drones"
                  onAction={() => window.location.assign('/drones')}
                />
              )}
            </Card>

            <Card className={styles.results}>
              <h2 className={styles.sectionHeading}>Your Recent Results</h2>
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
                    <span className={styles.alignRight}>Points</span>
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
                        <span
                          className={
                            won ? styles.resultWin : styles.resultLoss
                          }
                        >
                          {won ? 'WIN' : 'LOSS'}
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
            </Card>
          </div>

          {/* ---- RIGHT COLUMN ---- */}
          <div className={styles.rightCol}>
            <Card className={styles.liveFeed}>
              <h2 className={styles.sectionHeading}>Live Race Feed</h2>
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
                    });
                    return (
                      <Link
                        key={r.id}
                        href={`/races/${r.id}`}
                        className={styles.feedRow}
                      >
                        <span className={styles.feedTime}>{ts}</span>
                        <span className={styles.feedText}>
                          <span className={styles.feedWinner}>
                            {winner?.name ?? '—'}
                          </span>{' '}
                          beat {loser?.name ?? '—'} on {r.track?.name ?? '—'}
                        </span>
                      </Link>
                    );
                  })
                )}
              </div>
            </Card>

            <NextRaceCountdown
              targetDate={nextRaceAt}
              paused={racingPaused}
            />

            <Card className={styles.quickStatsCard}>
              <h2 className={styles.sectionHeading}>Quick Stats</h2>
              <div className={styles.quickStatsGrid}>
                <QuickStat
                  label="Total Races"
                  value={myStats?.totalRaces ?? 0}
                />
                <QuickStat label="Win Rate" value={userWinRate} />
                <QuickStat label="Streak" value={currentStreak} />
                <QuickStat
                  label="Rank"
                  value={myStats?.rank ? `#${myStats.rank}` : '—'}
                />
              </div>
            </Card>
          </div>
        </div>
      </div>
    </NavShell>
  );
}

function StatRow({ label, value, max = 100 }) {
  const cells = 10;
  const filled = Math.max(0, Math.min(cells, Math.round((value / max) * cells)));
  return (
    <div className={styles.statRow}>
      <span className={styles.statRowLabel}>{label}</span>
      <div className={styles.statRowBar}>
        {Array.from({ length: cells }).map((_, i) => (
          <span
            key={i}
            className={`${styles.statCell} ${
              i < filled ? styles.statCellFilled : ''
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function QuickStat({ label, value }) {
  return (
    <div className={styles.quickItem}>
      <span className={styles.quickValue}>{value}</span>
      <span className={styles.quickLabel}>{label}</span>
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
    <Card className={styles.countdownCard}>
      <h2 className={styles.sectionHeading}>Next Race Countdown</h2>
      {paused ? (
        <div className={styles.countdownPaused}>Paused</div>
      ) : !targetDate ? (
        <div className={styles.countdownPaused}>—</div>
      ) : (
        <>
          <div className={styles.countdownClock}>
            <span className={styles.countdownUnit}>{pad(days)}</span>
            <span className={styles.countdownColon}>:</span>
            <span className={styles.countdownUnit}>{pad(hours)}</span>
            <span className={styles.countdownColon}>:</span>
            <span className={styles.countdownUnit}>{pad(mins)}</span>
            <span className={styles.countdownColon}>:</span>
            <span className={styles.countdownUnit}>{pad(secs)}</span>
          </div>
          <div className={styles.countdownLabels}>
            <span>DD</span>
            <span>HH</span>
            <span>MM</span>
            <span>SS</span>
          </div>
          <div className={styles.countdownTagline}>Until Next Race</div>
        </>
      )}
    </Card>
  );
}
