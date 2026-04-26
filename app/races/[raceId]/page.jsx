'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Sun,
  Cloud,
  CloudRain,
  CloudDrizzle,
  Wind,
  CloudFog,
  Sunrise,
  Sunset,
  Moon,
  Trophy,
  Bot,
} from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import DataTable from '@/components/ui/DataTable';
import Skeleton from '@/components/ui/Skeleton';
import StatRadar from '@/components/ui/StatRadar';
import {
  cn,
  getLevelColor,
  getLevelTier,
  getDifficultyColor,
} from '@/lib/utils';
import { useSession } from '@/hooks/useSession';
import DroneImage from '@/components/ui/DroneImage';
import VoltIcon from '@/components/ui/VoltIcon';
import ModPlaceholder from '@/components/ui/ModPlaceholder';
import {
  STAT_KEYS,
  calculatePerStatCap,
} from '@/lib/game-engine/economy.js';
import styles from './page.module.css';

const RADAR_LABELS = {
  speed: 'SPD',
  turning: 'TRN',
  acceleration: 'ACC',
  durability: 'DUR',
  nightVision: 'NV',
  batteryCapacity: 'BAT',
  rainHandling: 'RAIN',
  windResistance: 'WIND',
  consistency: 'CST',
};

const WEATHER_ICONS = {
  clear: Sun,
  clouds: Cloud,
  rain: CloudDrizzle,
  heavy_rain: CloudRain,
  wind: Wind,
  haze: Cloud,
  fog: CloudFog,
};

const WEATHER_LABELS = {
  clear: 'Clear',
  clouds: 'Clouds',
  rain: 'Rain',
  heavy_rain: 'Heavy Rain',
  wind: 'Wind',
  haze: 'Haze',
  fog: 'Fog',
};

const TIME_ICONS = {
  dawn: Sunrise,
  day: Sun,
  dusk: Sunset,
  night: Moon,
};

const TIME_LABELS = {
  dawn: 'Dawn',
  day: 'Day',
  dusk: 'Dusk',
  night: 'Night',
};

function formatTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortId(id) {
  return id ? `#${id.slice(-8).toUpperCase()}` : '#-';
}

/** Count how many times the lead switched between the two drones. */
function countLeadChanges(log) {
  if (!log || log.length === 0) return 0;
  let changes = 0;
  let prev = null;
  for (const seg of log) {
    const lead = seg.drone1Time <= seg.drone2Time ? 1 : 2;
    if (prev !== null && prev !== lead) changes += 1;
    prev = lead;
  }
  return changes;
}

/**
 * Difficulty pill palette - matches the .pointsChip + level Badge pattern:
 * tinted 15% bg, full-colour text, no border, no glow. Teal easy, purple
 * mid, red extreme.
 */
const DIFFICULTY_STYLES = {
  easy: { fg: '#03DAC6', bg: 'rgba(3, 218, 198, 0.15)' },
  mid:  { fg: '#BB86FC', bg: 'rgba(187, 134, 252, 0.15)' },
  hard: { fg: '#CF6679', bg: 'rgba(207, 102, 121, 0.15)' },
};

function getDifficultyStyle(n /* 1-10 */) {
  if (n <= 3) return DIFFICULTY_STYLES.easy;
  if (n <= 7) return DIFFICULTY_STYLES.mid;
  return DIFFICULTY_STYLES.hard;
}

/** Cumulative lead gap per segment (+ = winner ahead, − = loser ahead). */
function computeWinnerGaps(log, winnerIsDrone1) {
  if (!log || log.length === 0) return [];
  const gaps = [];
  let cumW = 0;
  let cumL = 0;
  for (const seg of log) {
    const winT = Number(winnerIsDrone1 ? seg.drone1Time : seg.drone2Time);
    const losT = Number(winnerIsDrone1 ? seg.drone2Time : seg.drone1Time);
    cumW += winT;
    cumL += losT;
    gaps.push(cumL - cumW);
  }
  return gaps;
}

/** Cumulative winner-clock time at the end of each segment, in seconds. */
function computeWinnerCumTimes(log, winnerIsDrone1) {
  if (!log || log.length === 0) return [];
  const out = [];
  let cum = 0;
  for (const seg of log) {
    cum += Number(winnerIsDrone1 ? seg.drone1Time : seg.drone2Time);
    out.push(cum);
  }
  return out;
}

/** Single-sentence auto commentary derived from the race log. */
function generateCommentary(log, winnerIsDrone1, winnerName) {
  if (!log || log.length === 0 || !winnerName) return null;
  const leads = log.map((seg) => {
    const d1 = seg.drone1Time <= seg.drone2Time;
    return winnerIsDrone1 ? d1 : !d1;
  });
  const changes = leads.reduce(
    (acc, lead, i) => (i > 0 && lead !== leads[i - 1] ? acc + 1 : acc),
    0,
  );
  const ledFromStart = leads[0];
  let permanentLeadAt = -1;
  for (let i = leads.length - 1; i >= 0; i -= 1) {
    if (!leads[i]) {
      permanentLeadAt = i + 1; // next segment is where the final lead begins
      break;
    }
  }
  if (ledFromStart && changes === 0) {
    return `${winnerName} led from start to finish.`;
  }
  if (changes === 0) {
    return `${winnerName} closed strong to take the win.`;
  }
  if (changes === 1 && permanentLeadAt >= 0) {
    return `${winnerName} seized the lead at segment ${permanentLeadAt + 1} and never let go.`;
  }
  if (changes >= 4) {
    return `Lead traded ${changes} times - ${winnerName} prevailed.`;
  }
  return `${winnerName} edged ahead in the closing segments.`;
}

/**
 * Race detail page. Unwraps async params (Next 16) via React.use().
 */
export default function RaceDetailPage({ params }) {
  const { raceId } = use(params);
  const [race, setRace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/races/${raceId}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error || 'Failed to load race');
        } else {
          setRace(body.data);
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [raceId]);

  // Poll while the race is PENDING so the page transitions automatically
  // to the results view once the cron executes it. 5s cadence is fast
  // enough to feel instant near the lock-in moment without spamming the
  // API; stops as soon as we see status='completed'.
  useEffect(() => {
    if (race?.status !== 'pending') return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/races/${raceId}`);
        const body = await res.json();
        if (cancelled || !res.ok || !body?.data) return;
        setRace(body.data);
      } catch {
        /* keep stale until next tick */
      }
    };
    const id = setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [race?.status, raceId]);

  if (loading) {
    return (
      <NavShell>
        <div className={styles.page}>
          <Skeleton variant="text" width="40%" />
          <Skeleton variant="card" height={88} />
          <div className={styles.raceLayout}>
            <Skeleton variant="card" height={260} />
            <Skeleton variant="card" height={260} />
            <Skeleton variant="card" height={420} />
          </div>
        </div>
      </NavShell>
    );
  }

  if (error || !race) {
    return (
      <NavShell>
        <div className={styles.page}>
          <p className={styles.error}>{error || 'Race not found'}</p>
        </div>
      </NavShell>
    );
  }

  // Status dispatch: PENDING races get the strategy view (countdown +
  // matchup preview). COMPLETED races fall through to the results view
  // below. Single canonical URL `/races/[id]` survives the lifecycle -
  // the page just swaps content as the race transitions.
  if (race.status === 'pending') {
    return <RaceStrategyView race={race} />;
  }

  const winnerId = race.winnerDroneId;
  const winnerDrone =
    winnerId === race.drone1Id ? race.drone1 : race.drone2;
  const loserDrone =
    winnerId === race.drone1Id ? race.drone2 : race.drone1;

  const margin =
    race.drone1Time != null && race.drone2Time != null
      ? Math.abs(Number(race.drone1Time) - Number(race.drone2Time))
      : null;

  const winnerIsDrone1 = winnerId === race.drone1Id;
  const leadChanges = countLeadChanges(race.raceLog);
  const gaps = computeWinnerGaps(race.raceLog, winnerIsDrone1);
  const winnerCumTimes = computeWinnerCumTimes(race.raceLog, winnerIsDrone1);
  const maxGap = gaps.length > 0 ? Math.max(...gaps.map(Math.abs)) : null;
  const commentary = generateCommentary(
    race.raceLog,
    winnerIsDrone1,
    winnerDrone?.name,
  );

  const WeatherIcon = WEATHER_ICONS[race.weather] ?? Cloud;
  const TimeIcon = TIME_ICONS[race.timeOfDay] ?? Sun;

  // Tracks now store difficulty as an absolute 1-10 rating, paired with
  // level brackets enforced at matchmaking time - no client-side scaling.
  const difficultyOutOfTen = race.track?.difficulty ?? null;
  const difficultyStyle =
    difficultyOutOfTen != null ? getDifficultyStyle(difficultyOutOfTen) : null;

  const isComplete = Boolean(winnerId);

  return (
    <NavShell>
      <div className={styles.page}>
        {/* ---- Top meta strip (race id, timestamp, status) ---- */}
        <div className={styles.topStrip}>
          <div className={styles.metaLeft}>
            <span className={styles.metaLabel}>RACE</span>
            <span className={styles.metaId}>{shortId(race.id)}</span>
            <span className={styles.metaDivider} aria-hidden="true" />
            <span className={styles.metaTimestamp}>
              {formatTimestamp(race.createdAt)}
            </span>
          </div>
          <div
            className={`${styles.statusPill} ${
              isComplete ? styles.statusFinal : styles.statusLive
            }`}
          >
            <span className={styles.statusDot} aria-hidden="true" />
            <span>{isComplete ? 'FINAL' : 'LIVE'}</span>
          </div>
        </div>

        {/* ---- Headline result banner ---- */}
        {winnerDrone && (
          <div className={styles.headlineBanner}>
            <div className={styles.headlineLeft}>
              <Trophy
                size={16}
                className={styles.headlineTrophy}
                aria-hidden="true"
              />
              <div className={styles.headlineTextGroup}>
                <div className={styles.headlineTopLine}>
                  <span className={styles.headlineWinner}>
                    {winnerDrone.name}
                  </span>
                  <span className={styles.headlineWinAction}>
                    {margin != null
                      ? `wins by ${margin.toFixed(2)}s`
                      : 'wins'}
                  </span>
                </div>
                {commentary && (
                  <div className={styles.commentary}>{commentary}</div>
                )}
              </div>
            </div>
            <div className={styles.headlineRight}>
              {race.pointsAwarded != null && (
                <span className={styles.pointsChip}>
                  +<VoltIcon size={11} />
                  {race.pointsAwarded}
                </span>
              )}
              {leadChanges > 0 && (
                <span className={styles.conditionChip}>
                  LEAD CHANGED {leadChanges}×
                </span>
              )}
              {maxGap != null && maxGap > 0 && (
                <span className={styles.conditionChip}>
                  MAX GAP {maxGap.toFixed(2)}s
                </span>
              )}
            </div>
          </div>
        )}

        {/* ---- Grid: Winner / Challenger drone cards + Track + Race Log ---- */}
        {race.h2h && race.h2h.total > 0 && race.drone1 && race.drone2 && (
          <div className={styles.h2hLine}>
            Head to Head:{' '}
            {race.h2h.drone1Wins === race.h2h.drone2Wins ? (
              <>
                <span className={styles.h2hDrone}>{race.drone1.name}</span> and{' '}
                <span className={styles.h2hDrone}>{race.drone2.name}</span>{' '}
                tied {race.h2h.drone1Wins}-{race.h2h.drone2Wins}
              </>
            ) : race.h2h.drone1Wins > race.h2h.drone2Wins ? (
              <>
                <span className={styles.h2hDrone}>{race.drone1.name}</span>{' '}
                leads {race.h2h.drone1Wins}-{race.h2h.drone2Wins}
              </>
            ) : (
              <>
                <span className={styles.h2hDrone}>{race.drone2.name}</span>{' '}
                leads {race.h2h.drone2Wins}-{race.h2h.drone1Wins}
              </>
            )}
          </div>
        )}

        <div className={styles.raceLayout}>
          <div className={styles.drone1Slot}>
            <DroneCard
              drone={race.drone1}
              isWinner={race.drone1Id === winnerId}
              time={race.drone1Time}
              eloBefore={race.drone1EloBefore}
              eloChange={race.drone1EloChange}
              showUpset={race.isUpset && race.drone1Id === winnerId}
            />
          </div>
          <div className={styles.drone2Slot}>
            <DroneCard
              drone={race.drone2}
              isWinner={race.drone2Id === winnerId}
              time={race.drone2Time}
              eloBefore={race.drone2EloBefore}
              eloChange={race.drone2EloChange}
              showUpset={race.isUpset && race.drone2Id === winnerId}
            />
          </div>

          {gaps.length > 1 && (
            <Card className={styles.gapCard}>
              <h2 className={styles.sectionHeading}>
                Gap Over Race
              </h2>
              <div className={styles.sparklineWrap}>
                <GapSparkline gaps={gaps} times={winnerCumTimes} />
                {winnerCumTimes.length > 0 && (
                  <div className={styles.timeline} aria-hidden="true">
                    {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
                      <span
                        key={i}
                        className={styles.timelineTick}
                        style={{ left: `${f * 100}%` }}
                      >
                        {(
                          f * winnerCumTimes[winnerCumTimes.length - 1]
                        ).toFixed(1)}
                        s
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card className={styles.trackCard}>
            <div className={styles.trackHeaderRow}>
              <h2 className={styles.sectionHeading}>
                Track · {race.track?.name ?? 'Unknown track'}
              </h2>
              <div className={styles.trackHeaderRight}>
                {race.isNewTrackRecord && (
                  <span className={styles.trackRecordPill}>
                    NEW TRACK RECORD
                  </span>
                )}
                {difficultyOutOfTen != null && difficultyStyle && (
                  <span
                    className={styles.trackDifficulty}
                    style={{
                      background: difficultyStyle.bg,
                      color: difficultyStyle.fg,
                    }}
                  >
                    Difficulty {difficultyOutOfTen}/10
                  </span>
                )}
              </div>
            </div>
            <div className={styles.trackStatsRow}>
              <TrackStat
                label="Straights"
                value={race.track?.straights ?? 0}
              />
              <TrackStatDivider />
              <TrackStat label="Turns" value={race.track?.turns ?? 0} />
              <TrackStatDivider />
              <TrackStat label="Laps" value={race.track?.laps ?? 3} />
              <TrackStatDivider />
              <TrackStat
                label="Length"
                value={race.track?.length ?? '-'}
              />
            </div>
            <div className={styles.trackConditionsRow}>
              <span className={styles.conditionInline}>
                <WeatherIcon size={13} aria-hidden="true" />
                {WEATHER_LABELS[race.weather] ?? race.weather ?? '-'}
              </span>
              <TrackStatDivider />
              <span className={styles.conditionInline}>
                <TimeIcon size={13} aria-hidden="true" />
                {TIME_LABELS[race.timeOfDay] ?? race.timeOfDay ?? '-'}
              </span>
            </div>
            <div className={styles.trackImage} aria-label="Track visualization">
              <TrackSvg track={race.track} />
            </div>
          </Card>

          <Card className={styles.logCard}>
            <h2 className={styles.sectionHeading}>Race Log</h2>
            <div className={styles.logScroll}>
              <DataTable
                sortable
                emptyMessage="No log data."
                columns={[
                  {
                    key: 'segment',
                    label: '#',
                    align: 'right',
                    render: (r) => (
                      <span className={styles.logMono}>{r.segment}</span>
                    ),
                  },
                  {
                    key: 'lap',
                    label: 'Lap',
                    align: 'right',
                    render: (r) => (
                      <span className={styles.logMono}>{r.lap ?? '-'}</span>
                    ),
                  },
                  {
                    key: 'type',
                    label: 'Segment',
                    render: (r) => (
                      <span className={styles.logSegType}>{r.type}</span>
                    ),
                  },
                  {
                    key: 'drone1Time',
                    label: race.drone1?.name ?? 'Drone 1',
                    shortLabel: 'D1',
                    align: 'right',
                    sortable: true,
                    render: (r) => (
                      <span className={styles.logMono}>
                        {Number(r.drone1Time).toFixed(2)}s
                      </span>
                    ),
                  },
                  {
                    key: 'drone2Time',
                    label: race.drone2?.name ?? 'Drone 2',
                    shortLabel: 'D2',
                    align: 'right',
                    sortable: true,
                    render: (r) => (
                      <span className={styles.logMono}>
                        {Number(r.drone2Time).toFixed(2)}s
                      </span>
                    ),
                  },
                  {
                    key: 'lead',
                    label: 'Lead',
                    align: 'center',
                    render: (r) => {
                      const lead = r.drone1Time <= r.drone2Time ? 1 : 2;
                      return (
                        <span
                          className={
                            lead === 1 ? styles.lead1 : styles.lead2
                          }
                        >
                          {lead === 1 ? '◀' : '▶'}
                        </span>
                      );
                    },
                  },
                ]}
                data={race.raceLog ?? []}
              />
            </div>
          </Card>
        </div>
      </div>
    </NavShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function GapSparkline({ gaps, times }) {
  if (!gaps || gaps.length < 2) return null;
  const W = 300;
  const H = 56;
  const padY = 4;
  const maxAbs = Math.max(...gaps.map((g) => Math.abs(g)), 0.001);

  // If segment times are provided, position vertices proportional to
  // cumulative race time so x matches the timeline below. Otherwise fall
  // back to even segment-index spacing.
  const totalTime =
    times && times.length > 0 ? times[times.length - 1] : null;
  const useTime = Number.isFinite(totalTime) && totalTime > 0;

  const points = gaps.map((g, i) => {
    const x = useTime ? (times[i] / totalTime) * W : (i / (gaps.length - 1)) * W;
    const y = H / 2 - (g / maxAbs) * (H / 2 - padY);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPath = `M 0,${H / 2} L ${points.join(' L ')} L ${W},${H / 2} Z`;
  return (
    <svg
      className={styles.sparkline}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line
        x1="0"
        y1={H / 2}
        x2={W}
        y2={H / 2}
        className={styles.sparklineAxis}
      />
      <path d={areaPath} className={styles.sparklineArea} />
      <polyline
        points={points.join(' ')}
        className={styles.sparklineLine}
      />
    </svg>
  );
}

function TrackStat({ label, value }) {
  return (
    <div className={styles.trackStatItem}>
      <span className={styles.trackStatLabel}>{label}</span>
      <span className={styles.trackStatValue}>{value}</span>
    </div>
  );
}

function TrackStatDivider() {
  return <span className={styles.trackStatDivider} aria-hidden="true" />;
}

function DroneCard({ drone, isWinner, time, eloBefore, eloChange, showUpset }) {
  if (!drone) {
    return (
      <Card className={styles.droneCard}>
        <h2 className={styles.sectionHeading}>Challenger</h2>
        <div className={styles.droneCardBody}>Drone data missing</div>
      </Card>
    );
  }

  // Prefer the snapshotted pre-race ELO + signed delta for historical
  // accuracy; fall back to the drone's live rating when the race row
  // predates the ELO-snapshot columns.
  const eloDisplay =
    eloBefore != null && eloChange != null
      ? eloBefore + eloChange
      : drone.eloRating;
  const hasChange = eloChange != null && eloChange !== 0;
  const changeSign = eloChange != null && eloChange > 0 ? '+' : '';

  return (
    <Link href={`/drones/${drone.id}`} className={styles.droneLink}>
      <Card
        className={cn(
          styles.droneCard,
          styles[`level_${getLevelTier(drone.level)}`],
          isWinner && styles.winnerCard,
          drone.appliedSkin?.rarity &&
            drone.appliedSkin.rarity !== 'common' &&
            styles[`skinRarity_${drone.appliedSkin.rarity}`],
        )}
      >
        <h2
          className={cn(
            styles.sectionHeading,
            isWinner ? styles.winnerHeading : styles.challengerHeading,
          )}
        >
          {isWinner ? 'Winner' : 'Challenger'}
        </h2>

        <div className={styles.droneImageFrame}>
          <DroneImage
            drone={drone}
            alt={drone.name}
            className={styles.droneImg}
          />
          {showUpset && <span className={styles.upsetPill}>UPSET</span>}
        </div>

        <div className={styles.droneCardBody}>
          <div className={styles.droneHead}>
            <h3 className={styles.droneName}>{drone.name}</h3>
            <Badge variant="level" value={drone.level} />
          </div>
          <div className={styles.droneOwner}>
            Owner: {drone.userId ? drone.userId.slice(0, 8) : 'Bot'}
          </div>
          <div className={styles.droneMeta}>
            <div className={styles.droneMetaItem}>
              <span className={styles.metaKpiLabel}>ELO</span>
              <span className={styles.metaKpiValue}>
                {eloDisplay}
                {hasChange && (
                  <span
                    className={cn(
                      styles.eloDelta,
                      eloChange > 0 ? styles.eloDeltaUp : styles.eloDeltaDown,
                    )}
                  >
                    {' '}({changeSign}
                    {eloChange})
                  </span>
                )}
              </span>
            </div>
            <div className={styles.droneMetaItem}>
              <span className={styles.metaKpiLabel}>Time</span>
              <span className={styles.metaKpiValue}>
                {time != null ? `${Number(time).toFixed(2)}s` : '-'}
              </span>
            </div>
          </div>
          {drone.appliedMod && (
            <div className={styles.droneModRow}>
              <ModPlaceholder rarity={drone.appliedMod.rarity} size={24} />
              <div className={styles.droneModText}>
                <span className={styles.droneModName}>
                  {drone.appliedMod.name}
                </span>
                {drone.appliedMod.description && (
                  <span className={styles.droneModEffect}>
                    {drone.appliedMod.description}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}

function TrackSvg({ track }) {
  // Procedural racing-circuit outline based on track turn count. Each track id
  // gets a deterministic variant so different tracks look different.
  const turns = track?.turns ?? 6;
  const seed = hashString(track?.id ?? track?.name ?? 'track');
  const path = buildCircuit(turns, seed);

  return (
    <svg
      viewBox="0 0 800 200"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern
          id="startFinish"
          width="10"
          height="10"
          patternUnits="userSpaceOnUse"
        >
          <rect width="5" height="5" x="0" y="0" fill="#ffffff" />
          <rect width="5" height="5" x="5" y="5" fill="#ffffff" />
          <rect width="5" height="5" x="5" y="0" fill="#1a1a1a" />
          <rect width="5" height="5" x="0" y="5" fill="#1a1a1a" />
        </pattern>
      </defs>

      {/* Tarmac outline (thicker, darker) */}
      <path
        d={path}
        fill="none"
        stroke="#0d0d0d"
        strokeWidth="30"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Kerb/edge highlight */}
      <path
        d={path}
        fill="none"
        stroke="#1a1a1a"
        strokeWidth="22"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Racing line */}
      <path
        d={path}
        fill="none"
        stroke="#03DAC6"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity="0.95"
      />
      {/* Start/finish marker */}
      <rect
        x="56"
        y="83"
        width="10"
        height="34"
        fill="url(#startFinish)"
        stroke="#03DAC6"
        strokeWidth="1"
      />
    </svg>
  );
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildCircuit(turns, seed) {
  const rand = mulberry32(seed);
  const margin = 60;
  const w = 800;
  const h = 200;
  const r = 40 + Math.floor(rand() * 20);

  const x1 = margin;
  const y1 = margin;
  const x2 = w - margin;
  const y2 = h - margin;

  const extraTurns = Math.max(0, turns - 4);
  const chicaneCount = Math.min(extraTurns, 5);

  let path = `M ${x1 + r} ${y1}`;
  if (chicaneCount > 0) {
    const topLen = x2 - r - (x1 + r);
    const step = topLen / (chicaneCount + 1);
    for (let i = 1; i <= chicaneCount; i += 1) {
      const cx = x1 + r + step * i;
      const jog = 18 * (i % 2 === 0 ? 1 : -1);
      path += ` Q ${cx - step / 3} ${y1 + jog} ${cx} ${y1}`;
      path += ` T ${cx + step / 3} ${y1}`;
    }
  }
  path += ` L ${x2 - r} ${y1}`;
  path += ` Q ${x2} ${y1} ${x2} ${y1 + r}`;
  path += ` L ${x2} ${y2 - r}`;
  path += ` Q ${x2} ${y2} ${x2 - r} ${y2}`;
  path += ` L ${x1 + r} ${y2}`;
  path += ` Q ${x1} ${y2} ${x1} ${y2 - r}`;
  path += ` L ${x1} ${y1 + r}`;
  path += ` Q ${x1} ${y1} ${x1 + r} ${y1}`;
  path += ' Z';
  return path;
}

function mulberry32(a) {
  return function rand() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------------------------------------------------------------- */
/* Strategy view - rendered when race.status === 'pending'.                   */
/*                                                                            */
/* Top-to-bottom sections:                                                    */
/*   1. StatusBar  - centered text. "RACE LOCKS IN MM:SS" or pulsing teal     */
/*                   "RACE IN PROGRESS". Not a card.                          */
/*   2. H2HStrip   - thin card, single horizontal row of comparison stats.    */
/*   3. Drone cards - two side-by-side, drone-management style (radar +      */
/*                    form dots + stat strip), each links to /drones/[id].   */
/*   4. TrackSection - full-width card. Desktop: image left + info right.    */
/* -------------------------------------------------------------------------- */

function RaceStrategyView({ race }) {
  const { user } = useSession();
  // Hydrate each drone with its `recentRaces` (for form dots) + applied skin.
  // The race endpoint doesn't return recentRaces; /api/drones/[id] does.
  const [details, setDetails] = useState({ drone1: null, drone2: null });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const ids = [race.drone1?.id, race.drone2?.id].filter(Boolean);
      if (ids.length < 2) return;
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/drones/${id}`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ),
      );
      if (cancelled) return;
      setDetails({
        drone1: results[0]?.data ?? null,
        drone2: results[1]?.data ?? null,
      });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [race.drone1?.id, race.drone2?.id]);

  const drone1 = details.drone1 ?? race.drone1;
  const drone2 = details.drone2 ?? race.drone2;

  // Render the user's drone on the left/top, opponent on the right/bottom.
  // Falls back to the race-engine ordering when no session or neither drone
  // belongs to the viewer.
  const userDroneIsDrone1 = !!(user?.id && drone1?.userId === user.id);
  const userDroneIsDrone2 = !!(user?.id && drone2?.userId === user.id);
  const leftDrone = userDroneIsDrone2 ? drone2 : drone1;
  const rightDrone = userDroneIsDrone2 ? drone1 : drone2;

  const lvl1 = drone1?.level ?? 1;
  const lvl2 = drone2?.level ?? 1;
  const radarMax = calculatePerStatCap(Math.max(lvl1, lvl2));

  return (
    <NavShell>
      <div className={styles.matchupPage}>
        <StatusBar scheduledAt={race.scheduledAt} />
        <H2HStrip race={race} drone1={drone1} drone2={drone2} />
        <div className={styles.matchupGrid}>
          <MatchupDroneCard
            drone={leftDrone}
            opponent={rightDrone}
            radarMax={radarMax}
          />
          <MatchupDroneCard
            drone={rightDrone}
            opponent={leftDrone}
            radarMax={radarMax}
          />
        </div>
        <TrackSection race={race} />
      </div>
    </NavShell>
  );
}

/** Centered status text. "RACE LOCKS IN MM:SS" countdown, or pulsing teal
 *  "RACE IN PROGRESS" once the schedule passes. The parent page polls
 *  /api/races/[id] every 5s so the whole page flips to results view as
 *  soon as the cron executes. */
function StatusBar({ scheduledAt }) {
  const compute = () => {
    if (!scheduledAt) return 0;
    return Math.max(0, new Date(scheduledAt).getTime() - Date.now());
  };
  const [remaining, setRemaining] = useState(compute);
  useEffect(() => {
    setRemaining(compute());
    const id = setInterval(() => setRemaining(compute()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduledAt]);

  if (remaining <= 0) {
    return (
      <div className={cn(styles.statusBar, styles.statusBarLive)}>
        RACE IN PROGRESS
      </div>
    );
  }

  const total = Math.floor(remaining / 1000);
  const mins = String(Math.floor(total / 60)).padStart(2, '0');
  const secs = String(total % 60).padStart(2, '0');

  return (
    <div className={styles.statusBar}>
      RACE LOCKS IN {mins}:{secs}
    </div>
  );
}

/** Single-row comparison card: drone1 name · H2H · ELO · WIN RATE · drone2 name. */
function H2HStrip({ race, drone1, drone2 }) {
  if (!drone1 || !drone2) return null;

  const elo1 = drone1.eloRating ?? 0;
  const elo2 = drone2.eloRating ?? 0;
  const wr1 =
    drone1.totalRaces > 0
      ? `${Math.round(((drone1.wins ?? 0) / drone1.totalRaces) * 100)}%`
      : '-';
  const wr2 =
    drone2.totalRaces > 0
      ? `${Math.round(((drone2.wins ?? 0) / drone2.totalRaces) * 100)}%`
      : '-';

  return (
    <div className={styles.h2hStrip}>
      <span className={styles.h2hName}>{drone1.name}</span>
      <span className={styles.h2hSep} aria-hidden="true" />
      {race.h2h && race.h2h.total > 0 && (
        <>
          <span className={styles.h2hCell}>
            <span className={styles.h2hLabel}>H2H</span>
            <span className={styles.h2hValue}>
              {race.h2h.drone1Wins}-{race.h2h.drone2Wins}
            </span>
          </span>
          <span className={styles.h2hSep} aria-hidden="true" />
        </>
      )}
      <span className={styles.h2hCell}>
        <span className={styles.h2hLabel}>ELO</span>
        <span className={styles.h2hValue}>
          {elo1} vs {elo2}
        </span>
      </span>
      <span className={styles.h2hSep} aria-hidden="true" />
      <span className={styles.h2hCell}>
        <span className={styles.h2hLabel}>WIN RATE</span>
        <span className={styles.h2hValue}>
          {wr1} vs {wr2}
        </span>
      </span>
      <span className={styles.h2hSep} aria-hidden="true" />
      <span className={styles.h2hName}>{drone2.name}</span>
    </div>
  );
}

/** Drone card mirroring the drone-management view: image, name + level
 *  (drone-mgmt style, no Badge), full 9-axis radar, FORM dots, stat strip.
 *  Wraps in <Link> so clicking goes to /drones/[id] (read-only while race
 *  is PENDING). */
function MatchupDroneCard({ drone, opponent, radarMax }) {
  if (!drone) {
    return (
      <article className={styles.matchupCard} aria-hidden="true">
        <Skeleton variant="card" height={420} />
      </article>
    );
  }

  const tier = getLevelTier(drone.level);
  const radarStats = STAT_KEYS.reduce((acc, k) => {
    acc[k] = drone[k] ?? 0;
    return acc;
  }, {});
  const compareStats = opponent
    ? STAT_KEYS.reduce((acc, k) => {
        acc[k] = opponent[k] ?? 0;
        return acc;
      }, {})
    : null;
  const radarLabels = STAT_KEYS.map((k) => RADAR_LABELS[k]);

  const races = drone.recentRaces ?? [];
  const last5 = races.slice(0, 5);
  const dots = last5.map((r) => r.winnerDroneId === drone.id);
  const streakInfo = (() => {
    if (dots.length === 0) return { streak: 0, type: null };
    const first = dots[0];
    let streak = 1;
    for (let i = 1; i < dots.length; i += 1) {
      if (dots[i] === first) streak += 1;
      else break;
    }
    return { streak, type: first ? 'W' : 'L' };
  })();

  const winRate =
    drone.totalRaces > 0
      ? `${Math.round(((drone.wins ?? 0) / drone.totalRaces) * 100)}%`
      : '-';

  return (
    <Link
      href={`/drones/${drone.id}`}
      className={cn(styles.matchupCard, styles[`matchupCard_${tier}`])}
    >
      <div className={styles.matchupImageFrame}>
        <DroneImage
          drone={drone}
          alt={drone.name}
          className={styles.matchupImg}
        />
        {drone.isBot && (
          <span className={styles.matchupBotBadge}>
            <Bot size={11} aria-hidden="true" /> BOT
          </span>
        )}
      </div>

      <div className={styles.matchupNameRow}>
        <h3 className={styles.matchupName}>{drone.name}</h3>
        <span
          className={styles.matchupLevel}
          style={{ color: getLevelColor(drone.level) }}
        >
          LV {drone.level}
        </span>
      </div>

      <StatRadar
        axes={STAT_KEYS}
        stats={radarStats}
        compareStats={compareStats}
        labels={radarLabels}
        maxValue={radarMax}
        className={styles.matchupRadar}
      />

      <div className={styles.matchupFormStrip}>
        <span className={styles.matchupFormLabel}>Form</span>
        <div className={styles.matchupFormDots}>
          {dots.length > 0 ? (
            dots.map((won, i) => (
              <span
                key={i}
                className={cn(
                  styles.matchupFormDot,
                  won
                    ? styles.matchupFormDotWin
                    : styles.matchupFormDotLoss,
                )}
                aria-label={won ? 'Win' : 'Loss'}
              />
            ))
          ) : (
            <span className={styles.matchupFormEmpty}>-</span>
          )}
        </div>
        {streakInfo.type && (
          <span
            className={cn(
              styles.matchupFormStreak,
              streakInfo.type === 'W'
                ? styles.matchupFormStreakWin
                : styles.matchupFormStreakLoss,
            )}
          >
            {streakInfo.type}
            {streakInfo.streak}
          </span>
        )}
      </div>

      <div className={styles.matchupStatStrip}>
        <div className={styles.matchupStatItem}>
          <span className={styles.matchupStatLabel}>Total Races</span>
          <span className={styles.matchupStatValue}>
            {drone.totalRaces ?? 0}
          </span>
        </div>
        <div className={styles.matchupStatItem}>
          <span className={styles.matchupStatLabel}>Wins</span>
          <span className={styles.matchupStatValue}>{drone.wins ?? 0}</span>
        </div>
        <div className={styles.matchupStatItem}>
          <span className={styles.matchupStatLabel}>Losses</span>
          <span className={styles.matchupStatValue}>{drone.losses ?? 0}</span>
        </div>
        <div className={styles.matchupStatItem}>
          <span className={styles.matchupStatLabel}>Win Rate</span>
          <span className={styles.matchupStatValue}>{winRate}</span>
        </div>
        <div className={styles.matchupStatItem}>
          <span className={styles.matchupStatLabel}>ELO</span>
          <span className={styles.matchupStatValue}>
            {drone.eloRating ?? 0}
          </span>
        </div>
      </div>

      {drone.appliedMod && (
        <div className={styles.matchupModBlock}>
          <ModPlaceholder rarity={drone.appliedMod.rarity} size={28} />
          <div className={styles.matchupModText}>
            <span className={styles.matchupModName}>
              {drone.appliedMod.name}
            </span>
            {drone.appliedMod.description && (
              <span className={styles.matchupModEffect}>
                {drone.appliedMod.description}
              </span>
            )}
          </div>
        </div>
      )}
    </Link>
  );
}

/** Full-width track card. Desktop: image left (16/9, radius-md), info right
 *  (name + difficulty + specs + conditions). Mobile: stacks vertically. */
function TrackSection({ race }) {
  const track = race.track;
  if (!track) return null;
  const WeatherIcon = WEATHER_ICONS[race.weather] ?? Cloud;
  const TimeIcon = TIME_ICONS[race.timeOfDay] ?? Sun;
  const diff = Number(track.difficulty) || 0;
  const difficultyColor = getDifficultyColor(diff);

  return (
    <div className={styles.trackSection}>
      <div className={styles.trackImageBox}>
        {track.imageUrl ? (
          <img
            src={track.imageUrl}
            alt={track.name}
            className={styles.trackSectionImg}
          />
        ) : (
          <div className={styles.trackImagePlaceholder} aria-hidden="true" />
        )}
      </div>

      <div className={styles.trackInfo}>
        <h2 className={styles.trackName}>{track.name}</h2>

        <div
          className={styles.trackDiffRow}
          style={{ '--diff-color': difficultyColor }}
        >
          <span className={styles.trackDiffLabel}>Difficulty</span>
          <span className={styles.trackDiffDots} aria-hidden="true">
            {Array.from({ length: 10 }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  styles.trackDiffDot,
                  i < diff && styles.trackDiffDotOn,
                )}
              />
            ))}
          </span>
          <span className={styles.trackDiffScore}>{diff}/10</span>
        </div>

        <div className={styles.trackSpecRow}>
          <TrackSpec label="Straights" value={track.straights ?? 0} />
          <TrackSpecSep />
          <TrackSpec label="Turns" value={track.turns ?? 0} />
          <TrackSpecSep />
          <TrackSpec label="Laps" value={track.laps ?? 3} />
          <TrackSpecSep />
          <TrackSpec
            label="Length"
            value={(track.length ?? '-').toString().toUpperCase()}
          />
        </div>

        <div className={styles.trackCondRow}>
          <span className={styles.trackCondPill}>
            <WeatherIcon size={13} aria-hidden="true" />
            {WEATHER_LABELS[race.weather] ?? race.weather ?? '-'}
          </span>
          <span className={styles.trackCondPill}>
            <TimeIcon size={13} aria-hidden="true" />
            {TIME_LABELS[race.timeOfDay] ?? race.timeOfDay ?? '-'}
          </span>
        </div>
      </div>
    </div>
  );
}

function TrackSpec({ label, value }) {
  return (
    <span className={styles.trackSpecItem}>
      <span className={styles.trackSpecLabel}>{label}</span>
      <span className={styles.trackSpecValue}>{value}</span>
    </span>
  );
}

function TrackSpecSep() {
  return <span className={styles.trackSpecSep} aria-hidden="true" />;
}
