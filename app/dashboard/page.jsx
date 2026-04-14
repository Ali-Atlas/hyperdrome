'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import StatBar from '@/components/ui/StatBar';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useSession } from '@/hooks/useSession';
import { getLevelColor } from '@/lib/utils';
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

function formatRemaining(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function NextRacePill({ targetDate, paused }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused || !targetDate) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [paused, targetDate]);

  if (paused) {
    return (
      <span className={styles.nextRace}>
        <span className={styles.nextLabel}>Next race</span>
        <span className={styles.nextValuePaused}>Paused</span>
      </span>
    );
  }
  if (!targetDate) return null;
  const remaining = new Date(targetDate).getTime() - now;
  return (
    <span className={styles.nextRace}>
      <span className={styles.nextLabel}>Next race</span>
      <span className={styles.nextValue}>{formatRemaining(remaining)}</span>
    </span>
  );
}

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
        {/* ---- Top header: welcome + compact meta ---- */}
        <header className={styles.welcome}>
          <h1 className={styles.hello}>
            Welcome back, {user?.username ?? 'Player'}
          </h1>
          <div className={styles.welcomeMeta}>
            <NextRacePill targetDate={nextRaceAt} paused={racingPaused} />
            <span className={styles.points}>
              <span className={styles.pointsLabel}>Points</span>
              <span className={styles.pointsValue}>
                {(myStats?.points ?? user?.points ?? 0).toLocaleString()}
              </span>
            </span>
          </div>
        </header>

        {/* ---- Quick stats strip (thin horizontal row) ---- */}
        <div className={styles.quickStats}>
          <QuickStat label="Total Races" value={myStats?.totalRaces ?? 0} />
          <QuickStat label="Win Rate" value={userWinRate} />
          <QuickStat label="Streak" value={currentStreak} />
          <QuickStat
            label="Rank"
            value={myStats?.rank ? `#${myStats.rank}` : '—'}
          />
        </div>

        {/* ---- Main grid: spotlight + live feed ---- */}
        <div className={styles.grid}>
          <Card className={styles.spotlight}>
            <div className={styles.spotlightHeader}>
              <h2 className={styles.sectionHeading}>Active Drone Spotlight</h2>
              {canCycle && (
                <div className={styles.navCluster}>
                  <button
                    type="button"
                    className={styles.navBtn}
                    onClick={goPrev}
                    disabled={!canCycle}
                    aria-label="Previous drone"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className={styles.navCounter}>
                    {spotlightIndex + 1} / {activeDrones.length}
                  </span>
                  <button
                    type="button"
                    className={styles.navBtn}
                    onClick={goNext}
                    disabled={!canCycle}
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
              <div className={styles.spotlightBody}>
                <div className={styles.spotlightLeft}>
                  <div className={styles.spotlightImage}>
                    <img
                      src={spotlightDrone.imageUrl || '/drones/default.png'}
                      alt={spotlightDrone.name}
                    />
                  </div>
                  <div className={styles.spotlightIdentity}>
                    <div className={styles.spotlightNameLine}>
                      <span className={styles.droneName}>
                        {spotlightDrone.name}
                      </span>
                      <span
                        className={styles.droneLv}
                        style={{ color: getLevelColor(spotlightDrone.level) }}
                      >
                        LVL {spotlightDrone.level}
                      </span>
                    </div>
                    <div className={styles.spotlightOwner}>
                      Owner: {user?.username ?? '—'}
                    </div>
                    <div className={styles.spotlightKpiLine}>
                      {spotlightDrone.totalRaces} races · {droneWinRate} WR · W
                      {spotlightDrone.wins} / L{spotlightDrone.losses} · ELO{' '}
                      {spotlightDrone.eloRating}
                    </div>
                    <Link href={`/drones/${spotlightDrone.id}`}>
                      <Button variant="secondary" size="sm">
                        Manage Drone
                      </Button>
                    </Link>
                  </div>
                </div>
                <div className={styles.spotlightStats}>
                  {SPOTLIGHT_STATS.map(([key, label]) => (
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
        </div>

        {/* ---- Recent results (full width) ---- */}
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
                const opp = myDroneIds.has(r.drone1Id) ? r.drone2 : r.drone1;
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
                      className={won ? styles.resultWin : styles.resultLoss}
                    >
                      {won ? 'WIN' : 'LOSS'}
                    </span>
                    <span className={`${styles.mono} ${styles.alignRight}`}>
                      {won ? `+${r.pointsAwarded}` : '—'}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </NavShell>
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
