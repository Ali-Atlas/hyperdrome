'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  Sun,
  Cloud,
  CloudRain,
  CloudDrizzle,
  Wind,
  CloudFog,
  Sunrise,
  Sunset,
  Moon,
  Bot,
} from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import btnStyles from '@/components/ui/Button/Button.module.css';
import { cn, getLevelColor } from '@/lib/utils';
import DroneImage from '@/components/ui/DroneImage';
import EmptyState from '@/components/ui/EmptyState';
import RacingStatusPill from '@/components/ui/RacingStatusPill';
import Skeleton from '@/components/ui/Skeleton';
import StatRadar from '@/components/ui/StatRadar';
import ModPlaceholder from '@/components/ui/ModPlaceholder';
import { calculatePerStatCap } from '@/lib/game-engine/economy';
import { useSession } from '@/hooks/useSession';
import styles from './page.module.css';

const RADAR_AXES = [
  'speed',
  'turning',
  'acceleration',
  'durability',
  'nightVision',
  'batteryCapacity',
  'rainHandling',
  'windResistance',
  'consistency',
];

/* Icon maps shared with the upcoming-race widget. Mirrors the race
   detail page's mapping so visuals stay consistent. */
const WEATHER_ICONS = {
  clear: Sun,
  clouds: Cloud,
  rain: CloudDrizzle,
  heavy_rain: CloudRain,
  wind: Wind,
  haze: Cloud,
  fog: CloudFog,
};
const TIME_ICONS = {
  dawn: Sunrise,
  day: Sun,
  dusk: Sunset,
  night: Moon,
};
const WEATHER_LABEL = {
  clear: 'Clear',
  clouds: 'Clouds',
  rain: 'Rain',
  heavy_rain: 'Heavy Rain',
  wind: 'Wind',
  haze: 'Haze',
  fog: 'Fog',
};
const TIME_LABEL = {
  dawn: 'Dawn',
  day: 'Day',
  dusk: 'Dusk',
  night: 'Night',
};

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
  const [upcomingRaces, setUpcomingRaces] = useState([]);

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

  // Upcoming PENDING races for the current user. Polled separately on a
  // tighter 15s cadence than fetchAll so the countdown stays accurate.
  const fetchUpcoming = useCallback(async () => {
    if (!user?.id) {
      setUpcomingRaces([]);
      return;
    }
    try {
      const res = await fetch('/api/races/upcoming');
      const body = await res.json();
      if (res.ok && body?.data?.races) {
        setUpcomingRaces(body.data.races);
      }
    } catch {
      /* keep stale list on transient failure */
    }
  }, [user?.id]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  useEffect(() => {
    fetchUpcoming();
    const id = setInterval(fetchUpcoming, 15_000);
    return () => clearInterval(id);
  }, [fetchUpcoming]);

  const recentRaces = useMemo(() => {
    if (!myDrones.length) return [];
    const myDroneIds = new Set(myDrones.map((d) => d.id));
    return liveFeed
      .filter(
        (r) => myDroneIds.has(r.drone1Id) || myDroneIds.has(r.drone2Id),
      )
      .slice(0, 10);
  }, [liveFeed, myDrones]);

  /* Map: userDroneId -> upcoming race. Built from the cached
     /api/races/upcoming list so cycling drones in the spotlight is
     instant - no per-drone fetch needed for any drone the bulk endpoint
     already returned. */
  const upcomingByDroneId = useMemo(() => {
    const map = new Map();
    for (const r of upcomingRaces) {
      if (r.userDroneId) map.set(r.userDroneId, r);
    }
    return map;
  }, [upcomingRaces]);

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
    : '-';

  const currentStreak = useMemo(() => {
    if (!recentRaces.length || !myDrones.length) return '-';
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
    if (streak === 0) return '-';
    return `${streak > 0 ? 'W' : 'L'}${Math.abs(streak)}`;
  }, [recentRaces, myDrones]);

  const droneWinRate =
    spotlightDrone && spotlightDrone.totalRaces > 0
      ? ((spotlightDrone.wins / spotlightDrone.totalRaces) * 100).toFixed(1) +
        '%'
      : '-';

  const spotlightUpcoming = spotlightDrone
    ? upcomingByDroneId.get(spotlightDrone.id) ?? null
    : null;

  return (
    <NavShell>
      <div className={styles.page}>
        <div className={styles.grid}>
          {/* ---- Row 1 col 1: Spotlight ---- */}
          <Card
            className={cn(
              styles.spotlight,
              styles.areaSpotlight,
              spotlightDrone?.appliedSkin?.rarity &&
                spotlightDrone.appliedSkin.rarity !== 'common' &&
                styles[`skinRarity_${spotlightDrone.appliedSkin.rarity}`],
            )}
          >
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
                      LV {spotlightDrone.level}
                    </span>
                  </div>
                  <div className={styles.spotlightImage}>
                    <DroneImage
                      drone={spotlightDrone}
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

          {/* ---- Row 1 col 2: Next Race for selected spotlight drone ---- */}
          <NextRacePanel
            spotlightDrone={spotlightDrone}
            race={spotlightUpcoming}
            totalCount={upcomingRaces.length}
          />

          {/* ---- Row 2 col 2 (and below): Live Race Feed ---- */}
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
                        {winner?.name ?? '-'}
                      </span>
                      <span className={styles.feedWord}>beat</span>
                      <span className={styles.feedDrone}>
                        {loser?.name ?? '-'}
                      </span>
                      <span className={styles.feedWord}>on</span>
                      <span className={styles.feedTrack}>
                        {r.track?.name ?? '-'}
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
                  <span className={styles.alignRight}>Volts Earned</span>
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
                      <span>{opp?.name ?? '-'}</span>
                      <span>{r.track?.name ?? '-'}</span>
                      <span>
                        {won ? (
                          <span className={styles.resultWin}>WIN</span>
                        ) : (
                          <span className={styles.resultLoss}>LOSS</span>
                        )}
                      </span>
                      <span
                        className={`${styles.mono} ${styles.alignRight}`}
                      >
                        {won ? `+${r.pointsAwarded}` : '-'}
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
                value={myStats?.rank ? `#${myStats.rank}` : '-'}
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
        {paused ? <RacingStatusPill paused /> : 'Until Next Race'}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* NEXT RACE PANEL - sits in the dashboard grid alongside the spotlight       */
/* (replaces the prior standalone "Next Race" card above the grid). Tracks    */
/* the spotlight's currently-selected drone and renders that drone's          */
/* upcoming race; cycling the spotlight cycles which race is shown.           */
/*                                                                             */
/* Layout: header bar with countdown · two drones side-by-side with mini      */
/* radar charts under each · track strip with conditions · "view full         */
/* matchup" link. Empty state when the selected drone has no PENDING race.   */
/* -------------------------------------------------------------------------- */

function NextRacePanel({ spotlightDrone, race, totalCount }) {
  return (
    <Card className={cn(styles.nextRacePanel, styles.areaNextRace)}>
      <div className={styles.sectionHeadingRow}>
        <h2 className={styles.sectionHeading}>Next Race</h2>
        {race?.scheduledAt && (
          <LocksInCountdown
            targetDate={race.scheduledAt}
            className={styles.locksInCountdown}
          />
        )}
      </div>

      {race ? (
        <NextRaceMatchup race={race} totalCount={totalCount} />
      ) : (
        <div className={styles.nextRaceEmpty}>
          {spotlightDrone
            ? 'No upcoming race'
            : 'Activate a drone to see its next race'}
        </div>
      )}
    </Card>
  );
}

/** The matchup body inside NextRacePanel - shown only when there's a
 *  pending race for the currently spotlighted drone. */
function NextRaceMatchup({ race, totalCount }) {
  const isUserDrone1 = race.userDroneId === race.drone1?.id;
  const userDrone = isUserDrone1 ? race.drone1 : race.drone2;
  const opponent = isUserDrone1 ? race.drone2 : race.drone1;
  const moreCount = Math.max(0, (totalCount ?? 0) - 1);

  // Shared radar max for both sides: the higher of the two drones'
  // per-level stat caps. Both radars then render on the same scale so
  // a stronger drone's polygon is visibly larger than a weaker one's,
  // and the matchup correctly shows the strength gap instead of each
  // radar auto-scaling to its own drone (which flattens differences).
  const radarMax = Math.max(
    calculatePerStatCap(userDrone?.level ?? 1),
    calculatePerStatCap(opponent?.level ?? 1),
  );

  return (
    <div className={styles.nextRaceBody}>
      <div className={styles.matchupRow}>
        <NextRaceDroneSide
          drone={userDrone}
          opponent={opponent}
          tone="own"
          isOwn
          radarMax={radarMax}
        />
        <div className={styles.vsDivider}>VS</div>
        <NextRaceDroneSide
          drone={opponent}
          opponent={userDrone}
          tone="opponent"
          radarMax={radarMax}
        />
      </div>

      <div className={styles.trackStrip}>
        <span className={styles.trackName}>
          {race.track?.name ?? 'Unknown track'}
        </span>
        <span className={styles.trackSpecs}>
          <span>DIFF {race.track?.difficulty}/10</span>
          <span className={styles.trackSpecsSep}>·</span>
          <span>{race.track?.straights}S</span>
          <span className={styles.trackSpecsSep}>·</span>
          <span>{race.track?.turns}T</span>
          <span className={styles.trackSpecsSep}>·</span>
          <span>{race.track?.laps} LAPS</span>
          <span className={styles.trackSpecsSep}>·</span>
          <span>{(race.track?.length ?? '').toUpperCase()}</span>
        </span>
        <span className={styles.conditionPills}>
          <ConditionPill kind="weather" value={race.conditions?.weather} />
          <ConditionPill kind="time" value={race.conditions?.timeOfDay} />
        </span>
      </div>

      <div className={styles.nextRaceFooter}>
        <Link
          href={`/races/${race.id}`}
          className={styles.viewMatchupLink}
        >
          VIEW FULL MATCHUP →
        </Link>
        {moreCount > 0 && (
          <span className={styles.moreUpcomingLink}>
            {moreCount} MORE UPCOMING
          </span>
        )}
      </div>
    </div>
  );
}


/** Compact MM:SS countdown for the "LOCKS IN" timer in the section heading. */
function LocksInCountdown({ targetDate, className }) {
  const compute = () => {
    if (!targetDate) return 0;
    return Math.max(0, new Date(targetDate).getTime() - Date.now());
  };
  const [remaining, setRemaining] = useState(compute);
  useEffect(() => {
    setRemaining(compute());
    const id = setInterval(() => setRemaining(compute()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetDate]);

  if (remaining <= 0) {
    return (
      <span className={cn(styles.locksIn, styles.locksInExpired, className)}>
        RACING NOW
      </span>
    );
  }
  const total = Math.floor(remaining / 1000);
  const mins = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, '0');
  return (
    <span className={cn(styles.locksIn, className)}>
      LOCKS IN {mins}:{secs}
    </span>
  );
}

/** One side of the dashboard NEXT RACE matchup - drone image, name +
 *  level badge, and a compact stat-shape radar. The radar tone shifts
 *  to grey for the opponent so the user's own drone stays the visual
 *  anchor when both charts sit side-by-side. `radarMax` is shared
 *  between the two sides so polygon size = absolute strength. */
function NextRaceDroneSide({
  drone,
  opponent,
  tone = 'own',
  isOwn = false,
  radarMax,
}) {
  if (!drone) return <div className={styles.matchupSide} aria-hidden="true" />;
  return (
    <div className={styles.matchupSide}>
      {isOwn && <span className={styles.youBadge}>YOU</span>}
      {drone.isBot && (
        <span className={styles.botBadge} title="Bot drone">
          <Bot size={10} aria-hidden="true" /> BOT
        </span>
      )}
      <div className={styles.matchupImageFrame}>
        <DroneImage drone={drone} alt={drone.name} />
      </div>
      <div className={styles.matchupName}>
        {drone.name}
        <span
          className={styles.matchupLevel}
          style={{ color: getLevelColor(drone.level) }}
        >
          {' '}LV {drone.level}
        </span>
      </div>
      <div className={styles.matchupRadar}>
        <StatRadar
          axes={RADAR_AXES}
          stats={drone.stats ?? {}}
          compareStats={opponent?.stats}
          tone={tone}
          maxValue={radarMax}
        />
      </div>
      {drone.appliedMod && (
        <div className={styles.matchupModLine}>
          <ModPlaceholder rarity={drone.appliedMod.rarity} size={14} />
          <span className={styles.matchupModLineName}>
            {drone.appliedMod.name}
          </span>
        </div>
      )}
    </div>
  );
}

/** Small icon + label pill for weather + time-of-day conditions. */
function ConditionPill({ kind, value }) {
  if (!value) return null;
  const Icon = kind === 'weather'
    ? (WEATHER_ICONS[value] ?? Cloud)
    : (TIME_ICONS[value] ?? Sun);
  const label = kind === 'weather'
    ? (WEATHER_LABEL[value] ?? value)
    : (TIME_LABEL[value] ?? value);
  return (
    <span
      className={cn(
        styles.conditionPill,
        styles[`conditionPill_${kind}_${value}`],
      )}
    >
      <Icon size={10} aria-hidden="true" />
      <span>{label.toUpperCase()}</span>
    </span>
  );
}
