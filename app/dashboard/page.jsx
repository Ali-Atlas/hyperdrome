'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import StatBar from '@/components/ui/StatBar';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import CountdownTimer from '@/components/ui/CountdownTimer';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useSession } from '@/hooks/useSession';
import styles from './page.module.css';

const STAT_LABELS = [
  ['speed', 'Speed'],
  ['turning', 'Turning'],
  ['acceleration', 'Accel'],
  ['durability', 'Durability'],
  ['nightVision', 'Night Vision'],
  ['batteryCapacity', 'Battery'],
];

export default function DashboardPage() {
  const { user } = useSession();
  const [myDrones, setMyDrones] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentRaces, setRecentRaces] = useState([]);
  const [liveFeed, setLiveFeed] = useState([]);
  const [nextRaceAt, setNextRaceAt] = useState(null);
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
      if (racesRes?.data?.items) {
        setLiveFeed(racesRes.data.items.slice(0, 10));
      }
      if (nextRes?.data?.nextRaceAt) setNextRaceAt(nextRes.data.nextRaceAt);
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

  // Compute recent personal races (races involving any of the user's drones)
  useEffect(() => {
    if (!myDrones.length) {
      setRecentRaces([]);
      return;
    }
    const myDroneIds = new Set(myDrones.map((d) => d.id));
    const mine = liveFeed.filter(
      (r) => myDroneIds.has(r.drone1Id) || myDroneIds.has(r.drone2Id),
    );
    setRecentRaces(mine.slice(0, 10));
  }, [liveFeed, myDrones]);

  const activeDrones = useMemo(() => myDrones.filter((d) => d.active), [myDrones]);
  const spotlightDrone = activeDrones[activeIndex] ?? activeDrones[0];

  const winRate = myStats?.totalRaces
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

  return (
    <NavShell>
      <div className={styles.page}>
        <header className={styles.welcome}>
          <div>
            <h1 className={styles.hello}>
              Welcome back, {user?.username ?? 'Player'}
            </h1>
          </div>
          <div className={styles.balances}>
            <div className={styles.balanceItem}>
              <span className={styles.balanceLabel}>Points</span>
              <span className={styles.balanceValue}>
                {(myStats?.points ?? user?.points ?? 0).toLocaleString()}
              </span>
            </div>
          </div>
        </header>

        <div className={styles.grid}>
          {/* ---- Spotlight (top left, wide) ---- */}
          <Card className={styles.spotlight}>
            <div className={styles.spotlightHeader}>
              <h2 className={styles.sectionHeading}>Active Drone Spotlight</h2>
              {activeDrones.length > 1 && (
                <div className={styles.spotlightTabs}>
                  {activeDrones.map((d, i) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`${styles.spotlightTab} ${
                        i === activeIndex ? styles.spotlightTabActive : ''
                      }`}
                      onClick={() => setActiveIndex(i)}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {loading ? (
              <Skeleton variant="card" height={200} />
            ) : spotlightDrone ? (
              <div className={styles.spotlightBody}>
                <div className={styles.spotlightLeft}>
                  <div className={styles.spotlightImage}>
                    <DroneSvg />
                  </div>
                  <div className={styles.spotlightName}>{spotlightDrone.name}</div>
                  <Badge variant="level" value={spotlightDrone.level} />
                  <Link
                    href={`/drones/${spotlightDrone.id}`}
                    className={styles.manageBtnLink}
                  >
                    <Button variant="primary" size="md">Manage Drone</Button>
                  </Link>
                </div>
                <div className={styles.spotlightStats}>
                  {STAT_LABELS.map(([key, label]) => (
                    <StatBar
                      key={key}
                      label={label}
                      value={spotlightDrone[key]}
                      maxValue={100}
                      size="sm"
                    />
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState
                title="No active drone"
                description="Activate a drone from My Drones to enter the next race."
                actionLabel="Go to My Drones"
                onAction={() => window.location.assign('/drones')}
              />
            )}
          </Card>

          {/* ---- Live feed (right column) ---- */}
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
                      <span>
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

          {/* ---- Recent results ---- */}
          <Card className={styles.results}>
            <h2 className={styles.sectionHeading}>Your Recent Results</h2>
            {loading ? (
              <Skeleton variant="text" count={5} />
            ) : recentRaces.length === 0 ? (
              <p className={styles.empty}>
                No races yet. Activate a drone and wait for the next race block.
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
                  const mine = myDroneIds.has(r.drone1Id) ? r.drone1 : r.drone2;
                  const opp = myDroneIds.has(r.drone1Id) ? r.drone2 : r.drone1;
                  const won = myDroneIds.has(r.winnerDroneId);
                  return (
                    <div key={r.id} className={styles.resultsRow}>
                      <span>{opp?.name ?? '—'}</span>
                      <span>{r.track?.name ?? '—'}</span>
                      <span
                        className={
                          won ? styles.resultWin : styles.resultLoss
                        }
                      >
                        {won ? 'WIN' : 'LOSS'}
                      </span>
                      <span className={`${styles.mono} ${styles.alignRight}`}>
                        {won ? `+${r.pointsAwarded}` : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* ---- Countdown ---- */}
          <Card className={styles.countdown}>
            <h2 className={styles.sectionHeading}>Next Race Countdown</h2>
            {nextRaceAt ? (
              <div className={styles.countdownBig}>
                <CountdownTimer
                  targetDate={nextRaceAt}
                  expiredLabel="Racing now..."
                />
                <div className={styles.countdownCaption}>
                  Seconds until next block
                </div>
              </div>
            ) : (
              <Skeleton variant="text" width="60%" />
            )}
          </Card>

          {/* ---- Quick Stats ---- */}
          <div className={styles.quickStats}>
            <Card className={styles.quickCard}>
              <div className={styles.quickValue}>
                {myStats?.totalRaces ?? 0}
              </div>
              <div className={styles.quickLabel}>Total Races</div>
            </Card>
            <Card className={styles.quickCard}>
              <div className={styles.quickValue}>{winRate}</div>
              <div className={styles.quickLabel}>Win Rate</div>
            </Card>
            <Card className={styles.quickCard}>
              <div className={styles.quickValue}>{currentStreak}</div>
              <div className={styles.quickLabel}>Streak</div>
            </Card>
            <Card className={styles.quickCard}>
              <div className={styles.quickValue}>
                {myStats?.rank ? `#${myStats.rank}` : '—'}
              </div>
              <div className={styles.quickLabel}>Rank</div>
            </Card>
          </div>
        </div>
      </div>
    </NavShell>
  );
}

function DroneSvg() {
  return (
    <svg viewBox="0 0 240 160" xmlns="http://www.w3.org/2000/svg">
      <g stroke="#03DAC6" strokeWidth="1.5" fill="none">
        <line x1="40" y1="40" x2="100" y2="80" />
        <line x1="40" y1="120" x2="100" y2="80" />
        <line x1="200" y1="40" x2="140" y2="80" />
        <line x1="200" y1="120" x2="140" y2="80" />
        <polygon points="100,80 120,60 140,80 120,100" fill="rgba(3,218,198,0.3)" />
        <circle cx="40" cy="40" r="14" opacity="0.6" />
        <circle cx="40" cy="120" r="14" opacity="0.6" />
        <circle cx="200" cy="40" r="14" opacity="0.6" />
        <circle cx="200" cy="120" r="14" opacity="0.6" />
      </g>
    </svg>
  );
}
