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
} from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import DataTable from '@/components/ui/DataTable';
import Skeleton from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';
import styles from './page.module.css';

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

/** Difficulty tint — greens/teals for easy, purple mid, red for extreme. */
function getDifficultyColor(n /* 1-10 */) {
  if (n <= 3) return 'var(--accent-primary)';
  if (n <= 7) return 'var(--accent-secondary)';
  return 'var(--accent-error)';
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
  const maxGap = gaps.length > 0 ? Math.max(...gaps.map(Math.abs)) : null;
  const commentary = generateCommentary(
    race.raceLog,
    winnerIsDrone1,
    winnerDrone?.name,
  );

  const WeatherIcon = WEATHER_ICONS[race.weather] ?? Cloud;
  const TimeIcon = TIME_ICONS[race.timeOfDay] ?? Sun;

  const difficultyRaw = race.track?.difficulty ?? null;
  const difficultyOutOfTen =
    difficultyRaw != null ? Math.min(10, Math.max(1, difficultyRaw * 2)) : null;
  const difficultyColor =
    difficultyOutOfTen != null ? getDifficultyColor(difficultyOutOfTen) : null;

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
                size={20}
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
                  +{race.pointsAwarded} PTS
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
        <div className={styles.raceLayout}>
          <div className={styles.drone1Slot}>
            <DroneCard
              drone={race.drone1}
              isWinner={race.drone1Id === winnerId}
              time={race.drone1Time}
            />
          </div>
          <div className={styles.drone2Slot}>
            <DroneCard
              drone={race.drone2}
              isWinner={race.drone2Id === winnerId}
              time={race.drone2Time}
            />
          </div>

          <Card className={styles.trackCard}>
            <div className={styles.trackHeaderRow}>
              <h2 className={styles.sectionHeading}>
                Track · {race.track?.name ?? 'Unknown track'}
              </h2>
              {difficultyOutOfTen != null && (
                <span
                  className={styles.trackDifficulty}
                  style={{
                    color: difficultyColor,
                    borderColor: difficultyColor,
                  }}
                >
                  Difficulty {difficultyOutOfTen}/10
                </span>
              )}
            </div>
            <div className={styles.trackStatsRow}>
              <TrackStat
                label="Straights"
                value={race.track?.straights ?? 0}
              />
              <TrackStatDivider />
              <TrackStat label="Turns" value={race.track?.turns ?? 0} />
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
            {gaps.length > 1 && (
              <div className={styles.sparklineWrap}>
                <div className={styles.sparklineLabel}>
                  Gap over race (winner&apos;s advantage)
                </div>
                <GapSparkline gaps={gaps} />
              </div>
            )}
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

function GapSparkline({ gaps }) {
  if (!gaps || gaps.length < 2) return null;
  const W = 300;
  const H = 48;
  const padY = 4;
  const maxAbs = Math.max(...gaps.map((g) => Math.abs(g)), 0.001);
  const stepX = W / (gaps.length - 1);
  const points = gaps.map((g, i) => {
    const x = i * stepX;
    // Positive gap (winner ahead) sits above the center line.
    const y = H / 2 - (g / maxAbs) * (H / 2 - padY);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPath =
    `M 0,${H / 2} L ${points.join(' L ')} L ${W},${H / 2} Z`;
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

function DroneCard({ drone, isWinner, time }) {
  if (!drone) {
    return (
      <Card className={styles.droneCard}>
        <h2 className={styles.sectionHeading}>Challenger</h2>
        <div className={styles.droneCardBody}>Drone data missing</div>
      </Card>
    );
  }

  return (
    <Link href={`/drones/${drone.id}`} className={styles.droneLink}>
      <Card className={styles.droneCard}>
        <h2 className={styles.sectionHeading}>
          {isWinner ? 'Winner' : 'Challenger'}
        </h2>

        <div className={styles.droneImageFrame}>
          <img
            src={drone.imageUrl || '/drones/default.png'}
            alt={drone.name}
            className={styles.droneImg}
          />
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
              <span className={styles.metaKpiValue}>{drone.eloRating}</span>
            </div>
            <div className={styles.droneMetaItem}>
              <span className={styles.metaKpiLabel}>Time</span>
              <span className={styles.metaKpiValue}>
                {time != null ? `${Number(time).toFixed(2)}s` : '-'}
              </span>
            </div>
          </div>
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
