'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Zap, X } from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import btnStyles from '@/components/ui/Button/Button.module.css';
import { cn, getLevelColor } from '@/lib/utils';
import { getPendingToggle, usePendingToggleVersion } from '@/lib/pending-toggle';
import DroneImage from '@/components/ui/DroneImage';
import EmptyState from '@/components/ui/EmptyState';
import Spinner from '@/components/ui/Spinner';
import ConditionPill from '@/components/ui/ConditionPill';
import VoltIcon from '@/components/ui/VoltIcon';
import { useSession } from '@/hooks/useSession';
import { useUpcomingRaces } from '@/lib/upcoming-races-store';
import BootstrapPanel from './BootstrapPanel';
import NextRacePanel from './NextRacePanel';
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
  // Per-card loading flags so the dashboard renders progressively -
  // each card flips out of its spinner the moment its own fetch
  // resolves, instead of all four cards waiting on the slowest. Quick
  // Stats has no flag because it doesn't gate render: missing fields
  // fall back to 0 / 0% / '-' until the leaderboard fetch lands.
  const [loadingDrones, setLoadingDrones] = useState(true);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [loadingRecent, setLoadingRecent] = useState(true);
  /* Shared upcoming-races store - same source NavShell's countdown
   * footer reads, so the dashboard's "your upcoming" feed rows and
   * the footer's number chips can never disagree about how many
   * races the cron has just created. Handles the partial-set timing
   * (cron writes pending rows sequentially; a 15s poll can land
   * mid-insert) so we don't have to. */
  const { races: upcomingRaces } = useUpcomingRaces();

  // Fire all four fetches independently rather than awaiting them as
  // one Promise.all. Each card's spinner clears the moment its own
  // request resolves; the slowest fetch no longer holds the whole
  // dashboard in a single coupled spinner. Network volume is
  // unchanged - same four requests fire in parallel either way.
  //
  // The user-scoped recent-results request is conditional - skipped
  // when no session yet so we don't blast a `user_id=undefined` query
  // at the API. status=completed locks it to finished races so we
  // never show pending rows in the results table.
  const fetchAll = useCallback(() => {
    fetch('/api/drones')
      .then((r) => r.json())
      .then((res) => {
        if (res?.data) setMyDrones(res.data);
      })
      .catch(() => {})
      .finally(() => setLoadingDrones(false));

    // Live Race Feed shows global pending races (the current race
    // queue waiting on the cron tick). Cron emits at most ~3-9 races
    // per cycle so 20 rows is more than enough headroom; the feed is
    // scrolled inside a fixed-height container.
    fetch('/api/races?status=pending&limit=20')
      .then((r) => r.json())
      .then((res) => {
        if (res?.data?.items) setLiveFeed(res.data.items);
      })
      .catch(() => {})
      .finally(() => setLoadingFeed(false));

    fetch('/api/leaderboard/me')
      .then((r) => r.json())
      .then((res) => {
        if (res?.data) setMyStats(res.data);
      })
      .catch(() => {});

    if (user?.id) {
      fetch(`/api/races?user_id=${user.id}&status=completed&limit=20`)
        .then((r) => r.json())
        .then((res) => {
          if (res?.data?.items) setRecentRaces(res.data.items);
        })
        .catch(() => {})
        .finally(() => setLoadingRecent(false));
    } else {
      setRecentRaces([]);
      setLoadingRecent(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30_000);
    return () => clearInterval(id);
  }, [fetchAll]);

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

  /* Active drones sorted by level descending so the spotlight's
     initial slot (index 0) is always the user's highest-level drone.
     Stable sort within equal levels via the original myDrones order.
     Pending-aware: a drone with a queued deactivation is still
     effectively active for THIS race cycle (so it stays in the
     spotlight); a drone with a queued activation isn't effective yet
     (excluded). The version dep wakes the memo whenever the pending
     map mutates. */
  const pendingVersion = usePendingToggleVersion();
  const activeDrones = useMemo(
    () =>
      myDrones
        .filter((d) => {
          const p = getPendingToggle(d.id);
          // When pending exists, the OLD effective state is `!p.intended`
          // (DB has the new value, but matchmaking still sees the old
          // until the next race cycle).
          return p ? !p.intended : d.active;
        })
        .sort((a, b) => (b.level ?? 0) - (a.level ?? 0)),
    [myDrones, pendingVersion]
  );

  /* Upcoming races sorted by the user's drone level descending (the
     same axis the spotlight uses). With both spotlight and Next Race
     ordered identically, index 0 in each lines up naturally on first
     render - no separate initial sync needed. The Next-Race arrows
     also walk this same level-sorted order. */
  const sortedUpcomingRaces = useMemo(() => {
    if (myDrones.length === 0) return upcomingRaces;
    const droneById = new Map(myDrones.map((d) => [d.id, d]));
    const levelOf = (race) => droneById.get(race.userDroneId)?.level ?? 0;
    return [...upcomingRaces].sort((a, b) => levelOf(b) - levelOf(a));
  }, [upcomingRaces, myDrones]);

  /* Live feed ordering:
       1. The viewer's own pending races sit at the top, sourced from
          the shared upcoming-races store (NOT from the global pending
          fetch) so the hold-until-full-set logic prevents the feed
          from showing only 1 of the user's 3 races during the brief
          mid-cron creation window. API order = scheduledAt ascending.
       2. Everything else (other players' / bots' pending races) comes
          from the global pending fetch, filtered to exclude the
          viewer's own drones, then sorted by the higher-level drone
          in the matchup descending.
     The level sort applies to the no-drones-yet case too so guest
     viewers also see top-tier matchups first. */
  const maxMatchupLevel = (race) => Math.max(race.drone1?.level ?? 0, race.drone2?.level ?? 0);

  /* The /api/races endpoint returns flat race rows with `weather` and
     `timeOfDay` at the top level and `drone1Id` / `drone2Id` as scalar
     id fields. The /api/races/upcoming endpoint nests conditions under
     `conditions` and the drone ids inside `drone1` / `drone2`. Project
     the upcoming-shape rows into the live-feed shape so a single
     render pass reads both seamlessly. */
  const normaliseUpcomingForFeed = (r) => ({
    id: r.id,
    drone1Id: r.drone1?.id,
    drone2Id: r.drone2?.id,
    drone1: r.drone1,
    drone2: r.drone2,
    track: r.track,
    weather: r.conditions?.weather,
    timeOfDay: r.conditions?.timeOfDay,
  });

  const sortedLiveFeed = useMemo(() => {
    if (myDrones.length === 0) {
      return [...liveFeed].sort((a, b) => maxMatchupLevel(b) - maxMatchupLevel(a));
    }
    const myDroneIds = new Set(myDrones.map((d) => d.id));
    // Other players' races: filter out anything involving one of the
    // viewer's drones - those rows might be a partial set during cron
    // creation, and the upcoming store already covers them.
    const others = liveFeed.filter(
      (r) => !myDroneIds.has(r.drone1Id) && !myDroneIds.has(r.drone2Id)
    );
    others.sort((a, b) => maxMatchupLevel(b) - maxMatchupLevel(a));
    const mine = upcomingRaces.map(normaliseUpcomingForFeed);
    return [...mine, ...others];
  }, [liveFeed, myDrones, upcomingRaces]);

  useEffect(() => {
    if (activeDrones.length === 0) {
      setSpotlightIndex(0);
    } else if (spotlightIndex >= activeDrones.length) {
      setSpotlightIndex(0);
    }
  }, [activeDrones.length, spotlightIndex]);

  const spotlightDrone = activeDrones[spotlightIndex] ?? null;
  const canCycle = activeDrones.length > 1;

  // Spotlight arrows drive the Next Race panel directly: every cycle
  // looks up the new spotlighted drone's pending race in
  // `upcomingRaces` and jumps the Next Race index to it. Done inline
  // here (rather than via a useEffect on `spotlightDrone.id`) so
  // there's no chance of a stale-deps / batched-update gap that
  // would let a previous manual Next Race selection survive a
  // subsequent spotlight click. If the new spotlight drone has no
  // upcoming race the Next Race index is left alone.
  const syncNextRaceToDrone = (drone) => {
    if (!drone) return;
    const idx = sortedUpcomingRaces.findIndex((r) => r.userDroneId === drone.id);
    if (idx >= 0) setNextRaceIndex(idx);
  };

  const goPrev = () => {
    if (activeDrones.length === 0) return;
    const newIndex = (spotlightIndex - 1 + activeDrones.length) % activeDrones.length;
    setSpotlightIndex(newIndex);
    syncNextRaceToDrone(activeDrones[newIndex]);
  };
  const goNext = () => {
    if (activeDrones.length === 0) return;
    const newIndex = (spotlightIndex + 1) % activeDrones.length;
    setSpotlightIndex(newIndex);
    syncNextRaceToDrone(activeDrones[newIndex]);
  };

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
      ? ((spotlightDrone.wins / spotlightDrone.totalRaces) * 100).toFixed(1) + '%'
      : '-';

  const spotlightUpcoming = spotlightDrone
    ? (upcomingByDroneId.get(spotlightDrone.id) ?? null)
    : null;

  // Next-race cycling: the header arrows step through every PENDING
  // race the user is in (in level-sorted order). Reset to 0 whenever
  // the underlying list changes length so we never index past the
  // end after a race completes.
  const [nextRaceIndex, setNextRaceIndex] = useState(0);
  if (sortedUpcomingRaces.length > 0 && nextRaceIndex >= sortedUpcomingRaces.length) {
    setNextRaceIndex(0);
  }

  const nextRaceForCard = sortedUpcomingRaces[nextRaceIndex] ?? null;
  const nextRaceCanCycle = sortedUpcomingRaces.length > 1;
  const goPrevNextRace = () =>
    setNextRaceIndex((i) => (i - 1 + sortedUpcomingRaces.length) % sortedUpcomingRaces.length);
  const goNextNextRace = () => setNextRaceIndex((i) => (i + 1) % sortedUpcomingRaces.length);

  /* Auto-race info banner. Visibility hydrates on mount (reading
     localStorage during render would mismatch SSR markup): show only
     when onboarding has finished AND the user hasn't already dismissed
     this banner. Dismiss writes the flag and runs a short fade before
     unmounting so the banner doesn't pop. */
  const [bannerVisible, setBannerVisible] = useState(false);
  const [bannerExiting, setBannerExiting] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onboardingDone = window.localStorage.getItem('onboarding_complete') === '1';
    const dismissed = window.localStorage.getItem('races-banner-dismissed') === '1';
    if (onboardingDone && !dismissed) setBannerVisible(true);
  }, []);
  const dismissBanner = () => {
    setBannerExiting(true);
    window.setTimeout(() => {
      setBannerVisible(false);
      try {
        window.localStorage.setItem('races-banner-dismissed', '1');
      } catch {}
    }, 200);
  };

  return (
    <NavShell>
      <div className={styles.page}>
        {user && user.bootstrapState !== 'done' && <BootstrapPanel />}
        {bannerVisible && (
          <div className={cn(styles.banner, bannerExiting && styles.bannerExiting)} role="status">
            <span className={styles.bannerIconWrap} aria-hidden="true">
              <Zap size={18} className={styles.bannerIcon} />
            </span>
            <div className={styles.bannerContent}>
              <h2 className={styles.bannerTitle}>Auto-racing is live · every 3 minutes</h2>
              <p className={styles.bannerLede}>
                Hyperdrome runs a new race batch every 3 minutes. Up to{' '}
                <strong className={styles.bannerEm}>3 of your drones</strong> can be active at once
                - they enter the next batch automatically, no clicking start.
              </p>
              <dl className={styles.bannerLookup}>
                <div className={styles.bannerRow}>
                  <dt className={styles.bannerKey}>Control</dt>
                  <dd className={styles.bannerVal}>
                    Open a drone from{' '}
                    <Link href="/drones" className={styles.bannerLink}>
                      My Drones
                    </Link>{' '}
                    and toggle it active in its Drone Manager (3-active cap).
                  </dd>
                </div>
                <div className={styles.bannerRow}>
                  <dt className={styles.bannerKey}>Upcoming</dt>
                  <dd className={styles.bannerVal}>
                    Tap the 1 / 2 / 3 chips in the footer countdown bar to preview each of your
                    queued matchups.
                  </dd>
                </div>
                <div className={styles.bannerRow}>
                  <dt className={styles.bannerKey}>Results</dt>
                  <dd className={styles.bannerVal}>
                    Watch the <strong className={styles.bannerEm}>Live Race Feed</strong> below,
                    open any drone&apos;s page for its own history, or browse the full{' '}
                    <Link href="/races" className={styles.bannerLink}>
                      Races page
                    </Link>
                    .
                  </dd>
                </div>
              </dl>
            </div>
            <button
              type="button"
              className={styles.bannerDismiss}
              onClick={dismissBanner}
              aria-label="Dismiss"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className={styles.grid}>
          {/* ---- Row 1 col 1: Spotlight ---- */}
          <Card className={cn(styles.spotlight, styles.areaSpotlight)}>
            <div className={styles.sectionHeadingRow}>
              <h2 className={styles.sectionHeading}>Active Drone Spotlight</h2>
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

            {loadingDrones ? (
              <div className={cn(styles.cardBody, styles.loadingCenter)}>
                <Spinner size="md" />
              </div>
            ) : spotlightDrone ? (
              <div className={styles.spotlightBody}>
                <div className={styles.spotlightLeft}>
                  <div className={styles.droneNameBlock}>
                    <span className={styles.droneName}>{spotlightDrone.name}</span>
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
                    <DroneImage drone={spotlightDrone} alt={spotlightDrone.name} />
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
                      <StatRow key={key} label={label} value={spotlightDrone[key] ?? 0} />
                    ))}
                  </div>
                  <Link
                    href={`/drones/${spotlightDrone.id}`}
                    className={cn(
                      btnStyles.button,
                      btnStyles.primary,
                      btnStyles.sm,
                      styles.manageBtn
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
            loading={loadingDrones}
          />

          {/* ---- Row 2 col 2 (and below): Live Race Feed ---- */}
          <Card className={cn(styles.liveFeed, styles.areaFeed)}>
            <h2 className={styles.sectionHeading}>Live Race Feed</h2>
            <div className={cn(styles.cardBody, styles.feedBody)}>
              {loadingFeed ? (
                <div className={styles.loadingCenter}>
                  <Spinner size="md" />
                </div>
              ) : liveFeed.length === 0 ? (
                <p className={styles.empty}>No upcoming races.</p>
              ) : (
                <div className={cn(styles.tableScroll, styles.tableFeed)}>
                  <div className={styles.table}>
                    <div className={styles.tableHeader}>
                      <span>Drone 1</span>
                      <span>Drone 2</span>
                      <span>Track</span>
                      <span>Diff</span>
                      <span>Conditions</span>
                    </div>
                    {sortedLiveFeed.map((r) => {
                      const myDroneIds = new Set(myDrones.map((d) => d.id));
                      const drone1IsMine = myDroneIds.has(r.drone1Id);
                      const drone2IsMine = myDroneIds.has(r.drone2Id);
                      const showWeather = r.weather && r.weather !== 'clear';
                      const showTime = r.timeOfDay && r.timeOfDay !== 'day';
                      return (
                        <Link key={r.id} href={`/races/${r.id}`} className={styles.tableRow}>
                          <span className={styles.cellName}>
                            <span className={cn(styles.name, drone1IsMine && styles.nameYou)}>
                              {r.drone1?.name ?? '-'}
                            </span>
                            {r.drone1?.level != null && (
                              <span
                                className={styles.lv}
                                style={{
                                  color: getLevelColor(r.drone1.level),
                                }}
                              >
                                LV{r.drone1.level}
                              </span>
                            )}
                          </span>
                          <span className={styles.cellName}>
                            <span className={cn(styles.name, drone2IsMine && styles.nameYou)}>
                              {r.drone2?.name ?? '-'}
                            </span>
                            {r.drone2?.level != null && (
                              <span
                                className={styles.lv}
                                style={{
                                  color: getLevelColor(r.drone2.level),
                                }}
                              >
                                LV{r.drone2.level}
                              </span>
                            )}
                          </span>
                          <span className={styles.cellTrack}>{r.track?.name ?? '-'}</span>
                          <span className={styles.diff}>
                            {r.track?.difficulty != null ? `D${r.track.difficulty}` : '-'}
                          </span>
                          <span className={styles.conditions}>
                            {showWeather && (
                              <ConditionPill
                                kind="weather"
                                value={r.weather}
                                className={styles.condPill}
                              />
                            )}
                            {showTime && (
                              <ConditionPill
                                kind="time"
                                value={r.timeOfDay}
                                className={styles.condPill}
                              />
                            )}
                            {!showWeather && !showTime && <span className={styles.diff}>-</span>}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
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
              {loadingRecent ? (
                <div className={styles.loadingCenter}>
                  <Spinner size="md" />
                </div>
              ) : recentRaces.length === 0 ? (
                <p className={styles.empty}>
                  No races yet. Activate a drone and wait for the next race block.
                </p>
              ) : (
                <div className={cn(styles.tableScroll, styles.tableResults)}>
                  <div className={styles.table}>
                    <div className={styles.tableHeader}>
                      <span>You</span>
                      <span>Opponent</span>
                      <span>Track</span>
                      <span>Result</span>
                      <span title="Volts" aria-label="Volts">
                        <VoltIcon size={13} />
                      </span>
                      <span>Time</span>
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
                        ? (r.pointsAwarded ?? 0)
                        : (r.loserPointsAwarded ?? 0);
                      return (
                        <Link key={r.id} href={`/races/${r.id}`} className={styles.tableRow}>
                          <span className={styles.cellName}>
                            <span className={cn(styles.name, styles.nameYou)}>
                              {userDrone?.name ?? '-'}
                            </span>
                            {userDrone?.level != null && (
                              <span
                                className={styles.lv}
                                style={{
                                  color: getLevelColor(userDrone.level),
                                }}
                              >
                                LV{userDrone.level}
                              </span>
                            )}
                          </span>
                          <span className={styles.cellName}>
                            <span className={styles.name}>{opp?.name ?? '-'}</span>
                            {opp?.level != null && (
                              <span
                                className={styles.lv}
                                style={{
                                  color: getLevelColor(opp.level),
                                }}
                              >
                                LV{opp.level}
                              </span>
                            )}
                          </span>
                          <span className={styles.cellTrack}>{r.track?.name ?? '-'}</span>
                          <span>
                            {won ? (
                              <span className={styles.resultWin}>WIN</span>
                            ) : (
                              <span className={styles.resultLoss}>LOSS</span>
                            )}
                          </span>
                          <span className={voltsEarned > 0 ? styles.volts : undefined}>
                            +{voltsEarned}
                          </span>
                          <span className={styles.time}>{formatTimeAgo(r.createdAt)}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* ---- Row 2 col 2: Quick Stats ---- */}
          <Card className={cn(styles.quickStatsCard, styles.areaQuickStats)}>
            <div className={styles.sectionHeadingRow}>
              <h2 className={styles.sectionHeading}>Quick Stats</h2>
              {user?.username && <span className={styles.quickStatsUser}>{user.username}</span>}
            </div>
            <div className={styles.cardBody}>
              <div className={styles.quickStatsRow}>
                <QuickStat label="Total Races" value={myStats?.totalRaces ?? 0} />
                <QuickStat label="Win Rate" value={userWinRate} />
                <QuickStat label="Streak" value={currentStreak} />
                <QuickStat label="Season Rank" value={myStats?.rank ? `#${myStats.rank}` : '-'} />
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
        <div className={styles.statBarFill} style={{ width: `${pct}%` }} />
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
