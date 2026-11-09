'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bot, ChevronLeft, ChevronRight } from 'lucide-react';
import Card from '@/components/ui/Card';
import ConditionPill from '@/components/ui/ConditionPill';
import CountdownTimer from '@/components/ui/CountdownTimer';
import DroneImage from '@/components/ui/DroneImage';
import ModPlaceholder from '@/components/ui/ModPlaceholder';
import Spinner from '@/components/ui/Spinner';
import StatRadar from '@/components/ui/StatRadar';
import { lockInstantMs } from '@/lib/client/server-clock';
import { STAT_LABELS, computeRaceEdge, statDeltas, trackEdges } from '@/lib/game-engine/race-edge';
import { cn, getLevelColor } from '@/lib/utils';
import ModSwap from './ModSwap';
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

/** @typedef {import('./ModSwap').BoundMod} BoundMod */

/**
 * Whether the race's strategy window has closed, by the local clock or the server's. A race with
 * no `lockAt` (its commit outcome is unknown) counts as closed.
 * @param {string | null | undefined} lockAt
 * @returns {{ lockMs: number | null, locked: boolean }}
 */
function useRaceLock(lockAt) {
  const lockMs = lockAt ? lockInstantMs(lockAt) : null;
  const [passedAt, setPassedAt] = useState(() =>
    lockMs !== null && Date.now() >= lockMs ? lockMs : null
  );
  useEffect(() => {
    if (lockMs === null) return undefined;
    const id = setTimeout(() => setPassedAt(lockMs), Math.max(0, lockMs - Date.now()));
    return () => clearTimeout(id);
  }, [lockMs]);
  return { lockMs, locked: lockMs === null || passedAt === lockMs };
}

/**
 * The dashboard's Next Race card: the matchup, each side's edge, the swap control and the lock
 * countdown for the race shown. Cycling the spotlight cycles which race is shown.
 * @param {object} props
 * @param {object | null} props.spotlightDrone
 * @param {any} props.race
 * @param {number} props.totalCount
 * @param {number} props.currentIndex
 * @param {boolean} props.canCycle
 * @param {() => void} props.onPrev
 * @param {() => void} props.onNext
 * @param {boolean} props.loading
 */
export default function NextRacePanel({
  spotlightDrone,
  race,
  totalCount,
  currentIndex,
  canCycle,
  onPrev,
  onNext,
  loading,
}) {
  const { lockMs, locked } = useRaceLock(race?.lockAt);
  return (
    <Card className={cn(styles.nextRacePanel, styles.areaNextRace)}>
      {/* Whole-card click target. The Link is positioned absolutely
          over the panel so clicking anywhere on the card navigates to
          the race detail. The cycling buttons and the swap control sit
          at a higher z-index, so they escape the overlay. */}
      {race && (
        <Link
          href={`/races/${race.id}`}
          className={styles.nextRaceClickOverlay}
          aria-label={`View matchup ${(currentIndex ?? 0) + 1} of ${totalCount}`}
        />
      )}
      <div className={styles.sectionHeadingRow}>
        <h2 className={styles.sectionHeading}>Next Race</h2>
        {race && lockMs !== null && (
          <CountdownTimer
            className={styles.lockTimer}
            targetDate={new Date(lockMs).toISOString()}
            label="Lock"
            expiredLabel="Locked"
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
            <button type="button" className={styles.navBtn} onClick={onNext} aria-label="Next race">
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className={styles.loadingCenter}>
          <Spinner size="md" />
        </div>
      ) : race ? (
        <NextRaceMatchup key={race.id} race={race} locked={locked} />
      ) : (
        <div className={styles.nextRaceEmpty}>
          {spotlightDrone ? 'No upcoming race' : 'Activate a drone to see its next race'}
        </div>
      )}
    </Card>
  );
}

/**
 * @param {any} drone a side of an upcoming race
 * @param {number | null | undefined} modTemplateId
 */
const edgeSide = (drone, modTemplateId) => ({ stats: drone.stats, modTemplate: modTemplateId });

/**
 * The matchup body: both sides, their edges, the track strip.
 * @param {{ race: any, locked: boolean }} props
 */
function NextRaceMatchup({ race, locked }) {
  const isUserDrone1 = race.userDroneId === race.drone1?.id;
  const userDrone = isUserDrone1 ? race.drone1 : race.drone2;
  const opponent = isUserDrone1 ? race.drone2 : race.drone1;

  // After a swap's 200 the new mod shows at once; the store's next poll then agrees with it.
  const [swapped, setSwapped] = useState(/** @type {BoundMod | null | undefined} */ (undefined));
  const serverMod = userDrone?.appliedMod ?? null;
  if (swapped !== undefined && (swapped?.tokenId ?? null) === (serverMod?.tokenId ?? null)) {
    setSwapped(undefined);
  }
  const equipped = swapped !== undefined ? swapped : serverMod;

  const fitRace = useMemo(
    () =>
      race.track
        ? {
            track: race.track,
            weather: race.conditions?.weather,
            timeOfDay: race.conditions?.timeOfDay,
          }
        : null,
    [race]
  );

  const sides = useMemo(() => {
    if (!userDrone || !opponent || !fitRace) return null;
    const edges = trackEdges(
      edgeSide(userDrone, equipped?.template),
      edgeSide(opponent, opponent.appliedMod?.template),
      fitRace
    );
    const own = { ...userDrone.stats, eloRating: userDrone.elo, modTemplate: equipped?.template };
    const other = {
      ...opponent.stats,
      eloRating: opponent.elo,
      modTemplate: opponent.appliedMod?.template,
    };
    const favorite = computeRaceEdge(own, other, fitRace);
    const ownProb = favorite.viewer === own ? favorite.prob : 1 - favorite.prob;
    const ownDeltas = statDeltas(own, other);
    return {
      own: { edge: edges.a, prob: ownProb, top: ownDeltas.strengths[0] },
      other: {
        edge: edges.b,
        prob: 1 - ownProb,
        top: ownDeltas.gaps[0] && { ...ownDeltas.gaps[0], delta: -ownDeltas.gaps[0].delta },
      },
    };
  }, [userDrone, opponent, equipped, fitRace]);

  // Radar axes plot against the absolute stat ceiling (100), so a LV3 drone reads visibly small
  // and a LV20 drone visibly large on the same chart.
  const radarMax = 100;

  return (
    <div className={styles.nextRaceBody}>
      <div className={styles.matchupRow}>
        <NextRaceDroneSide
          drone={userDrone}
          opponent={opponent}
          isOwn
          radarMax={radarMax}
          edge={sides?.own}
          modSlot={
            <ModSwap
              race={race}
              drone={userDrone}
              equipped={equipped}
              fitRace={fitRace}
              locked={locked}
              onSwapped={setSwapped}
            />
          }
        />
        <div className={styles.vsDivider}>VS</div>
        <NextRaceDroneSide
          drone={opponent}
          opponent={userDrone}
          radarMax={radarMax}
          edge={sides?.other}
        />
      </div>

      <div className={styles.trackStrip}>
        <span className={styles.trackName}>{race.track?.name ?? 'Unknown track'}</span>
        <span className={styles.conditionPills}>
          <ConditionPill kind="weather" value={race.conditions?.weather} />
          <ConditionPill kind="time" value={race.conditions?.timeOfDay} />
        </span>
      </div>
    </div>
  );
}

/**
 * One side of the matchup: drone image, name and level, a stat-shape radar, the mod line and the
 * side's edge on this race.
 * @param {object} props
 * @param {any} props.drone
 * @param {any} props.opponent
 * @param {boolean} [props.isOwn]
 * @param {number} props.radarMax
 * @param {{ edge: number, prob: number, top?: { stat: keyof typeof STAT_LABELS, delta: number } } | undefined} props.edge
 * @param {React.ReactNode} [props.modSlot] replaces the read-only mod line on the player's side
 */
function NextRaceDroneSide({ drone, opponent, isOwn = false, radarMax, edge, modSlot }) {
  if (!drone) return <div className={styles.matchupSide} aria-hidden="true" />;
  const tone = drone.isBot ? 'bot' : isOwn ? 'own' : 'other';
  return (
    <div className={styles.matchupSide}>
      {isOwn && <span className={styles.youBadge}>YOU</span>}
      {!isOwn && drone.isBot && (
        <span className={styles.botBadge} title="Bot drone">
          <Bot size={10} aria-hidden="true" /> BOT
        </span>
      )}
      {!isOwn && !drone.isBot && drone.ownerName && (
        <span className={styles.opponentBadge} title={drone.ownerName}>
          {drone.ownerName}
        </span>
      )}
      <div className={styles.matchupImageFrame}>
        <DroneImage drone={drone} alt={drone.name} />
      </div>
      <div className={styles.matchupName}>
        {drone.name}
        <span className={styles.matchupLevel} style={{ color: getLevelColor(drone.level) }}>
          {' '}
          LV {drone.level}
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
      {modSlot ??
        (drone.appliedMod ? (
          <div className={styles.matchupModLine}>
            <ModPlaceholder rarity={drone.appliedMod.rarity} size={14} />
            <span className={styles.matchupModLineName}>{drone.appliedMod.name}</span>
          </div>
        ) : (
          <div className={styles.matchupModLineEmpty}>No mod</div>
        ))}
      {edge && (
        <div className={styles.matchupEdge}>
          <span
            className={cn(
              edge.edge > 0 && styles.matchupEdgePos,
              edge.edge < 0 && styles.matchupEdgeNeg
            )}
          >
            Edge {edge.edge > 0 ? '+' : ''}
            {edge.edge.toFixed(1)}
          </span>
          <span>Win {(edge.prob * 100).toFixed(1)}%</span>
          {edge.top && (
            <span className={styles.matchupEdgeStat}>
              {STAT_LABELS[edge.top.stat]} +{edge.top.delta}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
