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
import Skeleton from '@/components/ui/Skeleton';
import StatRadar from '@/components/ui/StatRadar';
import ModPlaceholder from '@/components/ui/ModPlaceholder';
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

/** Compact relative-time string for the recent-results table. Returns
 *  `<60s`, `Nm`, `Nh`, `Nd` to keep the column narrow on mobile. The
 *  recent-results list is paged from the API at limit=20 so values
 *  rarely exceed a few hours, but the day fallback is there so a
 *  freshly-onboarded user with old race history reads correctly. */
function formatTimeAgo(iso) {
  if (!iso) return '-';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function DashboardPage() {
  const { user } = useSession();
  const [myDrones, setMyDrones] = useState([]);
  const [spotlightIndex, setSpotlightIndex] = useState(0);
  const [liveFeed, setLiveFeed] = useState([]);
  const [recentRaces, setRecentRaces] = useState([]);
  const [myStats, setMyStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [upcomingRaces, setUpcomingRaces] = useState([]);

  const fetchAll = useCallback(async () => {
    try {
      // The user-scoped recent-races request is conditional - skipped
      // when no session yet so we don't blast a `user_id=undefined`
      // query at the API. The races route supports `user_id`
      // server-side, which is the correct path for "Your Recent
      // Results" (replaces the prior client-side filter from the
      // global top-20 list, which would silently empty under load).
      // The user-scoped recent-results request is conditional - skipped
      // when no session yet so we don't blast a `user_id=undefined`
      // query at the API. status=completed locks it to finished races
      // so we never show pending rows in the results table.
      const myRacesPromise = user?.id
        ? fetch(
            `/api/races?user_id=${user.id}&status=completed&limit=20`,
          )
            .then((r) => r.json())
            .catch(() => null)
        : Promise.resolve(null);
      const [dronesRes, racesRes, meRes, myRacesRes] = await Promise.all([
        fetch('/api/drones').then((r) => r.json()).catch(() => null),
        // Live Race Feed shows global pending races (the current race
        // queue waiting on the cron tick) so the surface actually
        // reads as "live". Up to 100 rows, scrolled inside a fixed
        // height container in the UI.
        fetch('/api/races?status=pending&limit=100')
          .then((r) => r.json())
          .catch(() => null),
        fetch('/api/leaderboard/me').then((r) => r.json()).catch(() => null),
        myRacesPromise,
      ]);
      if (dronesRes?.data) setMyDrones(dronesRes.data);
      if (racesRes?.data?.items) setLiveFeed(racesRes.data.items);
      if (meRes?.data) setMyStats(meRes.data);
      if (myRacesRes?.data?.items) {
        setRecentRaces(myRacesRes.data.items);
      } else if (!user?.id) {
        setRecentRaces([]);
      }
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

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

  // Next-race cycling: independent of the spotlight drone now. The header
  // arrows step through every PENDING race the user is in. Reset to 0
  // whenever the underlying list changes length so we never index past
  // the end after a race completes.
  const [nextRaceIndex, setNextRaceIndex] = useState(0);
  if (
    upcomingRaces.length > 0 &&
    nextRaceIndex >= upcomingRaces.length
  ) {
    setNextRaceIndex(0);
  }
  const nextRaceForCard = upcomingRaces[nextRaceIndex] ?? null;
  const nextRaceCanCycle = upcomingRaces.length > 1;
  const goPrevNextRace = () =>
    setNextRaceIndex(
      (i) => (i - 1 + upcomingRaces.length) % upcomingRaces.length,
    );
  const goNextNextRace = () =>
    setNextRaceIndex((i) => (i + 1) % upcomingRaces.length);

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
            race={nextRaceForCard}
            totalCount={upcomingRaces.length}
            currentIndex={nextRaceIndex}
            canCycle={nextRaceCanCycle}
            onPrev={goPrevNextRace}
            onNext={goNextNextRace}
          />

          {/* ---- Row 2 col 2 (and below): Live Race Feed ---- */}
          <Card className={cn(styles.liveFeed, styles.areaFeed)}>
            <h2 className={styles.sectionHeading}>Live Race Feed</h2>
            <div className={cn(styles.cardBody, styles.feedBody)}>
            {loading ? (
              <Skeleton variant="text" count={6} />
            ) : liveFeed.length === 0 ? (
              <p className={styles.empty}>No upcoming races.</p>
            ) : (
              <div className={styles.feedTable}>
                <div className={styles.feedHeader}>
                  <span>Time</span>
                  <span>You</span>
                  <span>Opponent</span>
                  <span>Track</span>
                </div>
                {liveFeed.map((r) => {
                  const myDroneIds = new Set(myDrones.map((d) => d.id));
                  const userIsDrone1 = myDroneIds.has(r.drone1Id);
                  const userIsDrone2 = myDroneIds.has(r.drone2Id);
                  // Anchor "You" to the user's drone if they have one in
                  // the matchup; otherwise fall back to drone1 so the row
                  // still reads two-up.
                  const userDrone = userIsDrone1
                    ? r.drone1
                    : userIsDrone2
                    ? r.drone2
                    : r.drone1;
                  const opp = userIsDrone1
                    ? r.drone2
                    : userIsDrone2
                    ? r.drone1
                    : r.drone2;
                  const ts = r.scheduledAt
                    ? new Date(r.scheduledAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      })
                    : '--:--';
                  return (
                    <Link
                      key={r.id}
                      href={`/races/${r.id}`}
                      className={styles.feedRow}
                    >
                      <span className={`${styles.mono}`}>{ts}</span>
                      <span>{userDrone?.name ?? '-'}</span>
                      <span>{opp?.name ?? '-'}</span>
                      <span>{r.track?.name ?? '-'}</span>
                    </Link>
                  );
                })}
              </div>
            )}
            <Link href="/races" className={styles.feedSeeAll}>
              See All Races →
            </Link>
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
                  <span>You</span>
                  <span>Opponent</span>
                  <span>Track</span>
                  <span>Result</span>
                  <span className={styles.alignRight}>Volts</span>
                  <span className={styles.alignRight}>Time</span>
                </div>
                {recentRaces.map((r) => {
                  const myDroneIds = new Set(myDrones.map((d) => d.id));
                  const userIsDrone1 = myDroneIds.has(r.drone1Id);
                  const userDrone = userIsDrone1 ? r.drone1 : r.drone2;
                  const opp = userIsDrone1 ? r.drone2 : r.drone1;
                  const won = myDroneIds.has(r.winnerDroneId);
                  // Loss payout pulled from `loserPointsAwarded` instead of
                  // dashing out: server already records both winner and
                  // loser earnings on every race row.
                  const voltsEarned = won
                    ? r.pointsAwarded ?? 0
                    : r.loserPointsAwarded ?? 0;
                  return (
                    <Link
                      key={r.id}
                      href={`/races/${r.id}`}
                      className={styles.resultsRow}
                    >
                      <span>{userDrone?.name ?? '-'}</span>
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
                        +{voltsEarned}
                      </span>
                      <span
                        className={`${styles.mono} ${styles.alignRight} ${styles.resultsTimeAgo}`}
                      >
                        {formatTimeAgo(r.createdAt)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
            </div>
          </Card>

          {/* ---- Row 2 col 2: Quick Stats ---- */}
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

function NextRacePanel({
  spotlightDrone,
  race,
  totalCount,
  currentIndex,
  canCycle,
  onPrev,
  onNext,
}) {
  return (
    <Card className={cn(styles.nextRacePanel, styles.areaNextRace)}>
      <div className={styles.sectionHeadingRow}>
        <h2 className={styles.sectionHeading}>Next Race</h2>
        {race && (
          <RaceQueuedBadge
            scheduledAt={race.scheduledAt}
            status={race.status}
          />
        )}
        {canCycle && (
          <div className={styles.navCluster}>
            <button
              type="button"
              className={styles.navBtn}
              onClick={onPrev}
              aria-label="Previous race"
            >
              <ChevronLeft size={14} />
            </button>
            <span className={styles.navCounter}>
              {(currentIndex ?? 0) + 1}/{totalCount}
            </span>
            <button
              type="button"
              className={styles.navBtn}
              onClick={onNext}
              aria-label="Next race"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {race ? (
        <NextRaceMatchup race={race} />
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
 *  pending race available. The cycling arrows in the panel header
 *  surface "current of total" so the panel no longer needs to show a
 *  redundant "MORE UPCOMING" caption inside the body. */
function NextRaceMatchup({ race }) {
  const isUserDrone1 = race.userDroneId === race.drone1?.id;
  const userDrone = isUserDrone1 ? race.drone1 : race.drone2;
  const opponent = isUserDrone1 ? race.drone2 : race.drone1;

  // Radar axes plot against the absolute stat ceiling (100), NOT the
  // per-level cap. A LV3 drone reads visibly small and a LV20 drone
  // reads visibly large on the same chart - the level difference is
  // the entire point of comparing them. Plotting against the per-level
  // cap would make every drone's radar look similarly full regardless
  // of level, flattening the very strength gap the chart should show.
  const radarMax = 100;

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
      </div>
    </div>
  );
}


/** Status badge that only appears when the race's scheduled time has
 *  passed and it's still pending - waiting on the next cron tick to
 *  execute. The countdown itself was removed from the next-race card:
 *  the global footer (NavShell `CountdownBar`) is the single source of
 *  truth for both "Next Round" and "Strategy Lock" timers, so duplicating
 *  one of them in the card was redundant. The badge tick (1s) is
 *  cheap and lets the badge appear right when scheduledAt elapses. */
function RaceQueuedBadge({ scheduledAt, status }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!scheduledAt || status !== 'pending') return null;
  const elapsed = new Date(scheduledAt).getTime() <= now;
  if (!elapsed) return null;
  return (
    <span className={cn(styles.locksIn, styles.locksInExpired)}>
      RACE QUEUED
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
      {drone.appliedMod ? (
        <div className={styles.matchupModLine}>
          <ModPlaceholder rarity={drone.appliedMod.rarity} size={14} />
          <span className={styles.matchupModLineName}>
            {drone.appliedMod.name}
          </span>
        </div>
      ) : (
        <div className={styles.matchupModLineEmpty}>No mod</div>
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
