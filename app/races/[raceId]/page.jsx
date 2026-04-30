'use client';

import { use, useEffect, useId, useState } from 'react';
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
  getDifficultyColor,
} from '@/lib/utils';
import { useSession } from '@/hooks/useSession';
import DroneImage from '@/components/ui/DroneImage';
import SkinThumb from '@/components/ui/SkinThumb';
import VoltIcon from '@/components/ui/VoltIcon';
import ModPlaceholder from '@/components/ui/ModPlaceholder';
import TrackPlaceholder from '@/components/tracks/TrackPlaceholder';
import {
  STAT_KEYS,
  calculatePerStatCap,
} from '@/lib/game-engine/economy.js';
import styles from './page.module.css';

/** Tracks with a transparent-optimized image at /tracks/<slug>.webp.
 *  Mirrored from app/tracks/page.jsx so the upcoming-race compact track
 *  card knows when to render an <img> vs a <TrackPlaceholder>. */
const TRACKS_WITH_IMAGES = [
  'horizon-express',
  'neon-straightaway',
  'the-grid',
  'circuit-alpha',
  'keyhole',
  'meridian',
];

/** Per-track accent color for the placeholder wireframe + name glow.
 *  Mirrored from app/tracks/page.jsx (kept in sync — if you rename a
 *  track or change a color, update both). */
const TRACK_ACCENT_COLORS = {
  'horizon-express':   '#00E676',
  'neon-straightaway': '#00E5FF',
  'keyhole':           '#40C4FF',
  'the-grid':          '#E0E0E0',
  'meridian':          '#00BFA5',
  'circuit-alpha':     '#FF9100',
  'crossfire':         '#FF4081',
  'iron-ribbon':       '#FF5252',
  'skyline-drift':     '#D050FF',
  'helix':             '#E040FB',
  'switchblade':       '#18FFFF',
  'phantom-circuit':   '#B0BEC5',
  'voltage-loop':      '#FFD600',
  'obsidian-maze':     '#FF6D00',
  'apex-descent':      '#D50000',
  'tempest-run':       '#FF1744',
};

function trackSlugFromName(name) {
  return (name ?? '').toLowerCase().trim().replace(/\s+/g, '-');
}

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

/**
 * Count how many times the *overall* race leader switched - i.e. the
 * cumulative time gap crosses zero. Per-segment wins that don't flip the
 * cumulative gap don't count: if A leads by 0.3s and B wins the next
 * segment by 0.1s, A is still ahead by 0.2s, no lead change.
 *
 * Tied segments (cumDiff === 0) are skipped rather than treated as their
 * own state, so an A → tied → A run isn't double-counted.
 */
function countLeadChanges(log) {
  if (!log || log.length === 0) return 0;
  let changes = 0;
  let cumDiff = 0;
  let prevSign = 0;
  for (const seg of log) {
    cumDiff += Number(seg.drone1Time) - Number(seg.drone2Time);
    const sign = cumDiff > 0 ? 1 : cumDiff < 0 ? -1 : 0;
    if (sign !== 0) {
      if (prevSign !== 0 && sign !== prevSign) changes += 1;
      prevSign = sign;
    }
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

/**
 * Single-sentence auto commentary derived from the race log. Lead-change
 * counting and "seized the lead at" detection both run off the cumulative
 * winner gap (positive = winner ahead) so the commentary stays consistent
 * with the LEAD CHANGED badge count.
 */
function generateCommentary(log, winnerIsDrone1, winnerName) {
  if (!log || log.length === 0 || !winnerName) return null;
  const gaps = computeWinnerGaps(log, winnerIsDrone1);
  let changes = 0;
  let prevSign = 0;
  for (const g of gaps) {
    const sign = g > 0 ? 1 : g < 0 ? -1 : 0;
    if (sign !== 0) {
      if (prevSign !== 0 && sign !== prevSign) changes += 1;
      prevSign = sign;
    }
  }
  const ledFromStart = gaps[0] > 0;
  // Last segment where the winner was cumulatively trailing (gap < 0).
  // The next segment is where they took the lead for good.
  let permanentLeadAt = -1;
  for (let i = gaps.length - 1; i >= 0; i -= 1) {
    if (gaps[i] < 0) {
      permanentLeadAt = i + 1;
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
  const { user } = useSession();
  const viewerUserId = user?.id ?? null;
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
  // Per-segment cumulative race time (average of the two drones) so the
  // x-axis can label "race seconds at this segment" without committing
  // to either drone's clock.
  const segmentTimes = (() => {
    if (!race.raceLog || race.raceLog.length === 0) return [];
    const out = [];
    let c1 = 0;
    let c2 = 0;
    for (const seg of race.raceLog) {
      c1 += Number(seg.drone1Time) || 0;
      c2 += Number(seg.drone2Time) || 0;
      out.push((c1 + c2) / 2);
    }
    return out;
  })();
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

  const trackSlug = trackSlugFromName(race.track?.name);
  const trackHasImage = TRACKS_WITH_IMAGES.includes(trackSlug);
  const trackAccent = TRACK_ACCENT_COLORS[trackSlug] ?? '#03DAC6';

  // Per-drone earnings. Winner volts read race.pointsAwarded; loser volts
  // read race.loserPointsAwarded (added April 2026). Rows written before
  // that column existed return null - fall back to the same formula the
  // service uses (see computeLoserPayout in race.service.js).
  const drone1IsWinner = race.drone1Id === winnerId;
  const drone2IsWinner = race.drone2Id === winnerId;
  const loserVolts =
    race.loserPointsAwarded ??
    1 + Math.floor(((drone1IsWinner ? race.drone2 : race.drone1)?.level ?? 0) / 4);
  const drone1Points = drone1IsWinner ? race.pointsAwarded : loserVolts;
  const drone2Points = drone2IsWinner ? race.pointsAwarded : loserVolts;
  const drone1Xp = drone1IsWinner ? race.xpWinner : race.xpLoser;
  const drone2Xp = drone2IsWinner ? race.xpWinner : race.xpLoser;

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
                  <VoltIcon size={11} />
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
          <div className={styles.raceLeft}>
          <div className={styles.drone1Slot}>
            <DroneCard
              drone={race.drone1}
              isWinner={drone1IsWinner}
              time={race.drone1Time}
              eloBefore={race.drone1EloBefore}
              eloChange={race.drone1EloChange}
              viewerUserId={viewerUserId}
              points={drone1Points}
              xp={drone1Xp}
            />
          </div>
          <div className={styles.drone2Slot}>
            <DroneCard
              drone={race.drone2}
              isWinner={drone2IsWinner}
              time={race.drone2Time}
              eloBefore={race.drone2EloBefore}
              eloChange={race.drone2EloChange}
              viewerUserId={viewerUserId}
              points={drone2Points}
              xp={drone2Xp}
            />
          </div>

          {/* Always render the gap card so the desktop grid keeps its
              gap | track row balanced. Empty state shows a dimmed line
              when the race log is too short to plot gaps (or missing
              entirely on legacy rows). */}
          <Card className={styles.gapCard}>
            <h2 className={styles.sectionHeading}>Gap Over Race</h2>
            {gaps.length > 1 ? (
              <div className={styles.sparklineWrap}>
                <GapSparkline gaps={gaps} segmentTimes={segmentTimes} />
              </div>
            ) : (
              <div className={styles.gapEmpty}>Gap data unavailable</div>
            )}
          </Card>

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
            <div className={styles.trackImage} aria-label="Track visualization">
              {trackHasImage ? (
                <img
                  src={`/tracks/${trackSlug.replace(/-/g, '_')}.webp`}
                  alt={race.track?.name ?? ''}
                  className={styles.trackImg}
                />
              ) : (
                <TrackPlaceholder
                  trackName={race.track?.name ?? ''}
                  accentColor={trackAccent}
                />
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
              <TrackStat label="Laps" value={race.track?.laps ?? 3} />
              <TrackStatDivider />
              <TrackStat
                label="Length"
                value={race.track?.length ?? '-'}
              />
            </div>
            <div className={styles.trackConditionsRow}>
              <span className={styles.trackConditionPill}>
                <WeatherIcon size={12} aria-hidden="true" />
                {WEATHER_LABELS[race.weather] ?? race.weather ?? '-'}
              </span>
              <span className={styles.trackConditionPill}>
                <TimeIcon size={12} aria-hidden="true" />
                {TIME_LABELS[race.timeOfDay] ?? race.timeOfDay ?? '-'}
              </span>
            </div>
          </Card>
          </div>

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

/** Format a signed gap value with explicit sign for non-zero values
 *  and 2-decimal precision with trailing zeros trimmed.
 *  +0.50 → "+0.5s", -0.345 → "-0.35s", 0.001 → "0s". */
function formatGapSeconds(s) {
  if (Math.abs(s) < 0.005) return '0s';
  const rounded = Number(s.toFixed(2));
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}s`;
}

/**
 * Signed gap chart. Positive (winner ahead) renders as a teal area
 * gradient above the zero line; negative (winner behind) as a red
 * gradient below. The zero line itself is positioned dynamically by
 * the data range, not at the visual center, so a race the winner led
 * end-to-end has the zero line near the bottom and a constant lead
 * sits high above it. Smooth curves via Catmull-Rom → cubic-Bezier.
 *
 * @param {{ gaps: number[], segmentTimes?: number[] }} props -
 *   `gaps`: signed cumulative gap per segment from the winner's
 *   perspective (positive = winner ahead, negative = winner behind).
 *   See `computeWinnerGaps`.
 *   `segmentTimes`: cumulative race time at each segment in seconds,
 *   used to label the x-axis. Same length as `gaps`. Optional: when
 *   absent, the x-axis labels are suppressed.
 */
function GapSparkline({ gaps, segmentTimes }) {
  // useId is called unconditionally so the rules-of-hooks early-return
  // guard below is safe. Colons are stripped because they break
  // url(#...) references in some specs.
  const rawId = useId();
  const idSafe = rawId.replace(/:/g, '');
  const gradPosId = `gap-pos-${idSafe}`;
  const gradNegId = `gap-neg-${idSafe}`;
  if (!gaps || gaps.length < 2) return null;

  const W = 300;
  const H = 100;
  const padTop = 8;
  const padBottom = 8;
  const usableH = H - padTop - padBottom;

  // Anchor the y-range so it always includes 0 (the lead-change line)
  // and add 8% breathing room top and bottom so the curve doesn't kiss
  // the edges. yMin / yMax are the unpadded extremes used for axis
  // labels; gapToY uses the padded range for screen-y mapping.
  const dataMin = Math.min(...gaps);
  const dataMax = Math.max(...gaps);
  const yMin = Math.min(0, dataMin);
  const yMax = Math.max(0, dataMax);
  const range = yMax - yMin || 1;
  const pad = range * 0.08;
  const yMinPadded = yMin - pad;
  const yMaxPadded = yMax + pad;
  const rangePadded = yMaxPadded - yMinPadded;
  const gapToY = (g) =>
    padTop + ((yMaxPadded - g) / rangePadded) * usableH;

  // X mapping: time-based when segmentTimes is supplied, so the curve
  // and the race-time tick labels along the bottom share the same axis.
  // Falls back to even segment-index spacing when no times (legacy logs).
  const hasTimes =
    Array.isArray(segmentTimes) &&
    segmentTimes.length === gaps.length &&
    segmentTimes[segmentTimes.length - 1] > 0;
  const totalTime = hasTimes ? segmentTimes[segmentTimes.length - 1] : 0;
  const xs = gaps.map((_, i) =>
    hasTimes
      ? (segmentTimes[i] / totalTime) * W
      : (i / (gaps.length - 1)) * W,
  );
  const ys = gaps.map(gapToY);
  const baselineY = gapToY(0);

  // Catmull-Rom (tension 0.5) → cubic-Bezier conversion. Edge points
  // reuse themselves as the missing neighbor so the curve doesn't jerk
  // at the start/end. Visually this produces smooth chart curves
  // without significant overshoot at typical race-data scales.
  let linePath = `M${xs[0].toFixed(2)},${ys[0].toFixed(2)}`;
  for (let i = 0; i < xs.length - 1; i += 1) {
    const p0x = xs[Math.max(0, i - 1)];
    const p0y = ys[Math.max(0, i - 1)];
    const p1x = xs[i];
    const p1y = ys[i];
    const p2x = xs[i + 1];
    const p2y = ys[i + 1];
    const p3x = xs[Math.min(xs.length - 1, i + 2)];
    const p3y = ys[Math.min(ys.length - 1, i + 2)];
    const cp1x = p1x + (p2x - p0x) / 6;
    const cp1y = p1y + (p2y - p0y) / 6;
    const cp2x = p2x - (p3x - p1x) / 6;
    const cp2y = p2y - (p3y - p1y) / 6;
    linePath += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2x.toFixed(2)},${p2y.toFixed(2)}`;
  }

  // Two area polygons - one closed to the chart bottom (for the
  // positive fill) and one closed to the chart top (for the negative
  // fill). Each is filled with a gradient anchored at the zero line so
  // the off-side region fades to fully transparent. No clip-paths
  // needed; the gradient transparency does the masking.
  const firstX = xs[0].toFixed(2);
  const lastX = xs[xs.length - 1].toFixed(2);
  const posAreaPath = `${linePath} L${lastX},${(H - padBottom).toFixed(2)} L${firstX},${(H - padBottom).toFixed(2)} Z`;
  const negAreaPath = `${linePath} L${lastX},${padTop.toFixed(2)} L${firstX},${padTop.toFixed(2)} Z`;

  // Y-axis labels: render the positive extreme only when the data
  // actually goes positive, and the negative extreme only when it goes
  // negative. The 0 label always renders at the dynamic zero-line
  // position. All three are absolutely positioned by their gap-to-y
  // mapping so the labels stay aligned with the chart's vertical
  // proportions instead of being evenly spaced by the flex container.
  const yLabelPct = (y) => `${(y / H) * 100}%`;

  // X-axis labels: round-second ticks across the race duration. Pick a
  // "nice" interval (5/10/15/20/30/60/90/120/180s) so the labels read as
  // 0s, 30s, 60s, 90s for a typical race. The smallest interval that
  // fits at most 5 ticks across the duration wins. The race-end is
  // appended as a final tick when the last interval-tick lands far short
  // of `totalTime`. Suppressed when segmentTimes isn't usable.
  const hasXAxis = hasTimes;
  const xLabels = (() => {
    if (!hasXAxis) return [];
    const niceIntervals = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300];
    const interval =
      niceIntervals.find((iv) => totalTime / iv <= 5) ?? 600;
    const ticks = [];
    for (let t = 0; t <= totalTime + 0.5; t += interval) {
      ticks.push(t);
    }
    const lastTick = ticks[ticks.length - 1];
    if (totalTime - lastTick > interval * 0.25) {
      ticks.push(Math.round(totalTime));
    }
    return ticks.map((t) => ({
      time: t,
      pct: (t / totalTime) * 100,
      text: `${Math.round(t)}s`,
    }));
  })();

  return (
    <div className={styles.sparklineFigure}>
    <div className={styles.sparklineChart}>
      <div className={styles.sparklineYAxis} aria-hidden="true">
        {yMax > 0 && (
          <span
            className={styles.sparklineYAxisLabel}
            style={{ top: yLabelPct(gapToY(yMax)) }}
          >
            {formatGapSeconds(yMax)}
          </span>
        )}
        <span
          className={styles.sparklineYAxisLabel}
          style={{ top: yLabelPct(baselineY) }}
        >
          0s
        </span>
        {yMin < 0 && (
          <span
            className={styles.sparklineYAxisLabel}
            style={{ top: yLabelPct(gapToY(yMin)) }}
          >
            {formatGapSeconds(yMin)}
          </span>
        )}
      </div>
      <svg
        className={styles.sparkline}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id={gradPosId}
            x1="0"
            y1={padTop}
            x2="0"
            y2={baselineY}
            gradientUnits="userSpaceOnUse"
          >
            <stop
              offset="0%"
              style={{ stopColor: 'var(--accent-primary)', stopOpacity: 0.55 }}
            />
            <stop
              offset="100%"
              style={{ stopColor: 'var(--accent-primary)', stopOpacity: 0 }}
            />
          </linearGradient>
          <linearGradient
            id={gradNegId}
            x1="0"
            y1={baselineY}
            x2="0"
            y2={H - padBottom}
            gradientUnits="userSpaceOnUse"
          >
            <stop
              offset="0%"
              style={{ stopColor: 'var(--accent-error)', stopOpacity: 0 }}
            />
            <stop
              offset="100%"
              style={{ stopColor: 'var(--accent-error)', stopOpacity: 0.55 }}
            />
          </linearGradient>
        </defs>
        <path d={posAreaPath} fill={`url(#${gradPosId})`} />
        <path d={negAreaPath} fill={`url(#${gradNegId})`} />
        <line
          x1="0"
          y1={baselineY}
          x2={W}
          y2={baselineY}
          className={styles.sparklineZero}
        />
        <path d={linePath} className={styles.sparklineLine} />
      </svg>
    </div>
      {hasXAxis && xLabels.length > 0 && (
        <div className={styles.sparklineXAxis} aria-hidden="true">
          <div className={styles.sparklineXAxisInner}>
            {xLabels.map((l, i) => {
              const isFirst = i === 0;
              const isLast = i === xLabels.length - 1;
              const style = isFirst
                ? { left: 0 }
                : isLast
                ? { right: 0 }
                : { left: `${l.pct}%`, transform: 'translateX(-50%)' };
              return (
                <span
                  key={l.time}
                  className={styles.sparklineXAxisLabel}
                  style={style}
                >
                  {l.text}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
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

function DroneCard({
  drone,
  isWinner,
  time,
  eloBefore,
  eloChange,
  viewerUserId,
  points,
  xp,
}) {
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

  // YOU badge for the viewer's own drone, owner username for any other
  // human player, "Bot" for matchmaker bots. Falls back to "Player" when
  // the username join didn't populate (defensive - shouldn't happen for
  // human-owned drones since getRaceById joins it).
  const isViewerDrone = !!(
    viewerUserId && drone.userId && drone.userId === viewerUserId
  );
  const ownerLabel = drone.isBot
    ? 'Bot'
    : drone.userId == null
      ? 'Bot'
      : drone.owner?.username ?? 'Player';

  return (
    <Link href={`/drones/${drone.id}`} className={styles.droneLink}>
      <Card className={styles.droneCard}>
        <h2 className={styles.sectionHeading}>
          {isWinner ? 'Winner' : 'Challenger'}
        </h2>

        <div className={styles.droneImageFrame}>
          <DroneImage
            drone={drone}
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
            {isViewerDrone ? (
              <span className={styles.droneOwnerYouBadge}>YOU</span>
            ) : (
              <>Owner: {ownerLabel}</>
            )}
          </div>
          <div className={styles.droneMeta}>
            <div className={styles.droneMetaSide}>
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
            {(points != null || xp != null) && (
              <div className={styles.droneMetaSide}>
                {points != null && (
                  <div className={styles.droneMetaItem}>
                    <span className={styles.metaKpiLabel}>
                      <VoltIcon size={10} />
                      VOLTS
                    </span>
                    <span className={styles.metaKpiValue}>+{points}</span>
                  </div>
                )}
                {xp != null && (
                  <div className={styles.droneMetaItem}>
                    <span className={styles.metaKpiLabel}>XP</span>
                    <span className={styles.metaKpiValue}>+{xp}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          {/* Mod row always renders so two drone cards keep matching
              heights even when one drone races without a mod. The
              empty state shows a dimmed placeholder + label. */}
          <div className={cn(
            styles.droneModRow,
            !drone.appliedMod && styles.droneModRowEmpty,
          )}>
            {drone.appliedMod ? (
              <>
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
              </>
            ) : (
              <>
                <ModPlaceholder
                  rarity="common"
                  size={24}
                  className={styles.droneModEmptyIcon}
                />
                <div className={styles.droneModText}>
                  <span className={styles.droneModEmptyText}>
                    No mod equipped
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Strategy view - rendered when race.status === 'pending'.                   */
/*                                                                            */
/* Top-to-bottom sections:                                                    */
/*   1. StatusBar      - centered text, "RACE LOCKS IN MM:SS" or pulsing     */
/*                       teal "RACE IN PROGRESS". Not a card.                */
/*   2. H2HStrip       - thin card, single horizontal row of comparison      */
/*                       stats.                                               */
/*   3. Drone cards    - two side-by-side, drone-management style (radar +   */
/*                       form dots + stat strip), each links to              */
/*                       /drones/[id].                                        */
/*   4. raceBottomGrid - 60/40 split at >=768px (stacks below):              */
/*        a. RaceTrackCard - mirrors /tracks index card; weather +           */
/*           time-of-day chips live in the bottom info bar, right-aligned.   */
/*        b. RaceEdgeCard - Strengths / Gaps / Win Probability for the       */
/*           "perspective drone" (user's drone if racing, else the favorite  */
/*           by ELO); header names the drone.                                */
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
        <H2HStrip race={race} drone1={drone1} drone2={drone2} />
        <div className={styles.matchupGrid}>
          <MatchupDroneCard
            drone={leftDrone}
            opponent={rightDrone}
            radarMax={radarMax}
            viewerUserId={user?.id}
            slotLabel="Drone 1"
          />
          <MatchupDroneCard
            drone={rightDrone}
            opponent={leftDrone}
            radarMax={radarMax}
            viewerUserId={user?.id}
            slotLabel="Drone 2"
          />
        </div>
        <div className={styles.raceBottomGrid}>
          <RaceTrackCard race={race} />
          <RaceEdgeCard
            leftDrone={leftDrone}
            rightDrone={rightDrone}
          />
        </div>
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

/** Single-row comparison card: drone1 name · H2H · ELO · WIN RATE · drone2 name.
 *  Per-comparison color: the higher value reads in --accent-primary, the
 *  lower in --text-secondary, and ties in --text-primary. Names at the
 *  ends mirror the ELO comparison since ELO is the canonical strength
 *  signal. */
function H2HStrip({ race, drone1, drone2 }) {
  if (!drone1 || !drone2) return null;

  const elo1 = drone1.eloRating ?? 0;
  const elo2 = drone2.eloRating ?? 0;
  const wrPct1 =
    drone1.totalRaces > 0 ? (drone1.wins ?? 0) / drone1.totalRaces : null;
  const wrPct2 =
    drone2.totalRaces > 0 ? (drone2.wins ?? 0) / drone2.totalRaces : null;
  const wr1 = wrPct1 != null ? `${Math.round(wrPct1 * 100)}%` : '-';
  const wr2 = wrPct2 != null ? `${Math.round(wrPct2 * 100)}%` : '-';

  const compareClass = (a, b) => {
    if (a == null || b == null) return styles.h2hValueNeutral;
    if (a === b) return styles.h2hValueNeutral;
    return a > b ? styles.h2hValueHigh : styles.h2hValueLow;
  };

  const eloClass1 = compareClass(elo1, elo2);
  const eloClass2 = compareClass(elo2, elo1);
  const wrClass1 = compareClass(wrPct1, wrPct2);
  const wrClass2 = compareClass(wrPct2, wrPct1);
  const h2hClass1 = compareClass(race.h2h?.drone1Wins, race.h2h?.drone2Wins);
  const h2hClass2 = compareClass(race.h2h?.drone2Wins, race.h2h?.drone1Wins);

  return (
    <div className={styles.h2hStrip}>
      <span className={cn(styles.h2hName, eloClass1)}>{drone1.name}</span>
      <span className={styles.h2hSep} aria-hidden="true" />
      {race.h2h && race.h2h.total > 0 && (
        <>
          <span className={styles.h2hCell}>
            <span className={styles.h2hLabel}>H2H</span>
            <span className={styles.h2hValue}>
              <span className={h2hClass1}>{race.h2h.drone1Wins}</span>
              <span className={styles.h2hValueSep}>-</span>
              <span className={h2hClass2}>{race.h2h.drone2Wins}</span>
            </span>
          </span>
          <span className={styles.h2hSep} aria-hidden="true" />
        </>
      )}
      <span className={styles.h2hCell}>
        <span className={styles.h2hLabel}>ELO</span>
        <span className={styles.h2hValue}>
          <span className={eloClass1}>{elo1}</span>
          <span className={styles.h2hValueSep}>vs</span>
          <span className={eloClass2}>{elo2}</span>
        </span>
      </span>
      <span className={styles.h2hSep} aria-hidden="true" />
      <span className={styles.h2hCell}>
        <span className={styles.h2hLabel}>WIN RATE</span>
        <span className={styles.h2hValue}>
          <span className={wrClass1}>{wr1}</span>
          <span className={styles.h2hValueSep}>vs</span>
          <span className={wrClass2}>{wr2}</span>
        </span>
      </span>
      <span className={styles.h2hSep} aria-hidden="true" />
      <span className={cn(styles.h2hName, eloClass2)}>{drone2.name}</span>
    </div>
  );
}

/** Drone card on the strategy view. Layout:
 *   1. Name + level + viewer/owner badge above the image
 *   2. Hero image (matches dashboard spotlight sizing)
 *   3. Two-column row on desktop: radar | metadata (form + stat strip)
 *   4. Mod block (always rendered; "No mod" placeholder when none)
 *  Wraps in <Link> so clicking goes to /drones/[id] (read-only while race
 *  is PENDING). */
function MatchupDroneCard({ drone, opponent, radarMax, viewerUserId, slotLabel }) {
  if (!drone) {
    return (
      <article className={styles.matchupCard} aria-hidden="true">
        <Skeleton variant="card" height={420} />
      </article>
    );
  }

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

  // Owner badge: BOT for bots, YOU for the viewer's own drone, or the
  // owner's username for any other player.
  const isViewerDrone = !!(viewerUserId && drone.userId === viewerUserId);
  const ownerName = drone.owner?.username ?? null;

  return (
    <Link href={`/drones/${drone.id}`} className={styles.matchupCard}>
      {slotLabel && (
        <h2 className={styles.sectionHeading}>{slotLabel}</h2>
      )}
      <div className={styles.matchupContent}>
        <div className={styles.matchupHeader}>
          <h3 className={styles.matchupName}>{drone.name}</h3>
          <div className={styles.matchupHeaderMeta}>
            <span
              className={styles.matchupLevel}
              style={{ color: getLevelColor(drone.level) }}
            >
              LV {drone.level}
            </span>
            {drone.isBot ? (
              <span className={styles.matchupBotBadge}>
                <Bot size={11} aria-hidden="true" /> BOT
              </span>
            ) : isViewerDrone ? (
              <span className={styles.matchupYouBadge}>YOU</span>
            ) : ownerName ? (
              <span className={styles.matchupOwnerBadge}>{ownerName}</span>
            ) : null}
          </div>
        </div>

        <div className={styles.matchupImageFrame}>
        <DroneImage
          drone={drone}
          alt={drone.name}
          className={styles.matchupImg}
        />
      </div>

      <div className={styles.matchupSplit}>
        <div className={styles.matchupRadarCol}>
          <StatRadar
            axes={STAT_KEYS}
            stats={radarStats}
            compareStats={compareStats}
            labels={radarLabels}
            maxValue={radarMax}
            className={styles.matchupRadar}
          />
        </div>

        <div className={styles.matchupMetaCol}>
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
              <span className={styles.matchupStatValue}>
                {drone.losses ?? 0}
              </span>
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
        </div>
      </div>

        <div className={styles.collectibleRow}>
          <div className={styles.skinBlock}>
            <span className={styles.skinLabel}>Skin Equipped</span>
            <div
              className={cn(
                styles.modSelector,
                styles.modSelectorReadOnly,
                drone.appliedSkin?.rarity &&
                  styles[`modSelector_${drone.appliedSkin.rarity}`],
              )}
            >
              {drone.appliedSkin ? (
                <SkinThumb
                  skin={drone.appliedSkin}
                  rarity={drone.appliedSkin.rarity}
                  alt={drone.appliedSkin.name}
                  className={styles.skinSwatch}
                />
              ) : (
                <span className={styles.skinSwatch} aria-hidden="true" />
              )}
              <div className={styles.modCurrentText}>
                <span className={styles.modName}>
                  {drone.appliedSkin?.name ?? 'No skin equipped'}
                </span>
              </div>
            </div>
          </div>

          <div className={styles.modBlock}>
            <span className={styles.modLabel}>Mod Equipped</span>
            <div
              className={cn(
                styles.modSelector,
                styles.modSelectorReadOnly,
                drone.appliedMod?.rarity &&
                  styles[`modSelector_${drone.appliedMod.rarity}`],
              )}
            >
              <ModPlaceholder
                rarity={drone.appliedMod?.rarity ?? 'common'}
                size={20}
                className={styles.modSelectorIcon}
              />
              <div className={styles.modCurrentText}>
                <span className={styles.modName}>
                  {drone.appliedMod?.name ?? 'No mod equipped'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

/** Full-width track card. Desktop: image left (16/9, radius-md), info right
 *  (name + difficulty + specs + conditions). Mobile: stacks vertically. */
/** Standalone track preview card mirroring /tracks index: grey name bar,
 *  transparent image, grey info bar. The info bar carries track stats on
 *  the left and weather + time-of-day chip pills on the right. */
function RaceTrackCard({ race }) {
  const track = race.track;
  if (!track) return null;
  const slug = trackSlugFromName(track.name);
  const hasImage = TRACKS_WITH_IMAGES.includes(slug);
  const accentColor = TRACK_ACCENT_COLORS[slug] ?? '#03DAC6';
  const diff = Number(track.difficulty) || 0;
  const difficultyColor = getDifficultyColor(diff);
  const WeatherIcon = WEATHER_ICONS[race.weather] ?? Cloud;
  const TimeIcon = TIME_ICONS[race.timeOfDay] ?? Sun;

  return (
    <article className={styles.raceTrackCard}>
      <h3 className={styles.raceTrackName}>{track.name}</h3>
      <div className={styles.raceTrackImage}>
        {hasImage ? (
          <img
            src={`/tracks/${slug.replace(/-/g, '_')}.webp`}
            alt={track.name}
            className={styles.raceTrackImg}
          />
        ) : (
          <TrackPlaceholder
            trackName={track.name}
            accentColor={accentColor}
          />
        )}
      </div>
      <div className={styles.raceTrackInfo}>
        <div className={styles.raceTrackStats}>
          <div className={styles.raceTrackMetaRow}>
            <span
              className={styles.raceTrackMetaItem}
              style={{ '--diff-color': difficultyColor }}
            >
              <span className={styles.raceTrackMetaLabel}>Difficulty</span>
              <span className={styles.raceTrackDiffScore}>{diff}/10</span>
            </span>
            <span className={styles.raceTrackMetaItem}>
              <span className={styles.raceTrackMetaLabel}>Length</span>
              <span className={styles.raceTrackMetaValue}>
                {(track.length ?? '-').toString().toUpperCase()}
              </span>
            </span>
          </div>
          <div className={styles.raceTrackSpecs}>
            <span className={styles.raceTrackSpec}>
              <span className={styles.raceTrackSpecLabel}>Straights</span>
              <span className={styles.raceTrackSpecValue}>
                {track.straights ?? 0}
              </span>
            </span>
            <span className={styles.raceTrackSpecSep} aria-hidden="true" />
            <span className={styles.raceTrackSpec}>
              <span className={styles.raceTrackSpecLabel}>Turns</span>
              <span className={styles.raceTrackSpecValue}>
                {track.turns ?? 0}
              </span>
            </span>
            <span className={styles.raceTrackSpecSep} aria-hidden="true" />
            <span className={styles.raceTrackSpec}>
              <span className={styles.raceTrackSpecLabel}>Laps</span>
              <span className={styles.raceTrackSpecValue}>
                {track.laps ?? 3}
              </span>
            </span>
          </div>
        </div>
        <div className={styles.raceTrackPills}>
          <span className={styles.raceConditionPill}>
            <WeatherIcon
              size={12}
              aria-hidden="true"
              className={styles.raceConditionPillIcon}
            />
            {WEATHER_LABELS[race.weather] ?? race.weather ?? '-'}
          </span>
          <span className={styles.raceConditionPill}>
            <TimeIcon
              size={12}
              aria-hidden="true"
              className={styles.raceConditionPillIcon}
            />
            {TIME_LABELS[race.timeOfDay] ?? race.timeOfDay ?? '-'}
          </span>
        </div>
      </div>
    </article>
  );
}

/** Pick the perspective drone for the edge container.
 *
 *  - When the viewer owns one of the racing drones, that drone is the
 *    perspective (this is the existing behavior the rest of the page
 *    already uses for left/right ordering).
 *  - When the viewer is spectating, the favorite (higher ELO) takes
 *    the perspective so the headline reads as "this is who's expected
 *    to win, and here's why."
 *
 *  Returns `[perspectiveDrone, otherDrone]`. The header in
 *  `RaceEdgeCard` names the perspective drone explicitly so a viewer
 *  always sees whose strengths/gaps they're looking at.
 */
/**
 * Compute the race-edge perspective and win probability from ELO alone.
 * Higher-prob drone is the favorite. If the prob lands within 2% of 50%
 * the matchup is flagged as "even" - the card shows EVEN MATCHUP in the
 * header and skips the "favorite" framing. No ownership / left-side
 * tiebreak: it's pure ELO math.
 *
 * @returns {{ isEven: boolean, viewer: object, opponent: object,
 *             viewerElo: number, oppElo: number, prob: number }}
 */
function computeRaceEdge(left, right) {
  const lElo = left?.eloRating ?? 1000;
  const rElo = right?.eloRating ?? 1000;
  const leftProb = 1 / (1 + Math.pow(10, (rElo - lElo) / 400));
  const isEven = Math.abs(leftProb - 0.5) <= 0.02;
  if (leftProb >= 0.5) {
    return {
      isEven,
      viewer: left,
      opponent: right,
      viewerElo: lElo,
      oppElo: rElo,
      prob: leftProb,
    };
  }
  return {
    isEven,
    viewer: right,
    opponent: left,
    viewerElo: rElo,
    oppElo: lElo,
    prob: 1 - leftProb,
  };
}

/** Race-edge container: Strengths / Gaps / Win Probability for the
 *  perspective drone. Sits to the right of the track at >=768px and
 *  stacks beneath at <768px. The header always names the drone whose
 *  perspective is shown. */
function RaceEdgeCard({ leftDrone, rightDrone }) {
  if (!leftDrone || !rightDrone) {
    return (
      <section className={styles.raceEdgeCard}>
        <h3 className={styles.raceEdgeHeader}>Race Edge</h3>
        <div className={styles.raceEdgeBody}>
          <div className={styles.raceEdgeNone}>—</div>
        </div>
      </section>
    );
  }
  const { isEven, viewer, opponent, viewerElo, oppElo, prob } = computeRaceEdge(
    leftDrone,
    rightDrone,
  );
  const deltas = STAT_KEYS.map((k) => ({
    stat: k,
    label: RADAR_LABELS[k] ?? k,
    delta: (viewer[k] ?? 0) - (opponent[k] ?? 0),
  }));
  const advantages = deltas
    .filter((d) => d.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3);
  const gaps = deltas
    .filter((d) => d.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 3);

  const pct = Math.round(prob * 100);

  return (
    <section className={styles.raceEdgeCard}>
      <h3 className={styles.raceEdgeHeader}>
        {isEven ? (
          <span className={styles.raceEdgeHeaderTitle}>Even Matchup</span>
        ) : (
          <>
            <span className={styles.raceEdgeHeaderTitle}>Race Edge</span>
            <span className={styles.raceEdgeHeaderDrone}>{viewer.name}</span>
          </>
        )}
      </h3>
      <div className={styles.raceEdgeBody}>
        <div className={styles.raceEdgeSection}>
          <span className={styles.raceEdgeSectionLabel}>Strengths</span>
          {advantages.length === 0 ? (
            <span className={styles.raceEdgeNone}>None</span>
          ) : (
            <ul className={styles.raceEdgeList}>
              {advantages.map((d) => (
                <li key={d.stat} className={styles.raceEdgeRow}>
                  <span className={styles.raceEdgeStat}>{d.label}</span>
                  <span
                    className={cn(
                      styles.raceEdgeDelta,
                      styles.raceEdgeDeltaPos,
                    )}
                  >
                    +{d.delta}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={styles.raceEdgeSection}>
          <span className={styles.raceEdgeSectionLabel}>Gaps</span>
          {gaps.length === 0 ? (
            <span className={styles.raceEdgeNone}>None</span>
          ) : (
            <ul className={styles.raceEdgeList}>
              {gaps.map((d) => (
                <li key={d.stat} className={styles.raceEdgeRow}>
                  <span className={styles.raceEdgeStat}>{d.label}</span>
                  <span
                    className={cn(
                      styles.raceEdgeDelta,
                      styles.raceEdgeDeltaNeg,
                    )}
                  >
                    {d.delta}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={styles.raceEdgeSection}>
          <span className={styles.raceEdgeSectionLabel}>Win Probability</span>
          <div className={styles.raceEdgeWinValue}>{pct}%</div>
          <div className={styles.raceEdgeWinBar}>
            <div
              className={styles.raceEdgeWinBarFill}
              style={{ width: `${pct}%` }}
              aria-hidden="true"
            />
          </div>
          <div className={styles.raceEdgeWinCaption}>
            ELO {viewerElo} vs {oppElo}
          </div>
        </div>
      </div>
    </section>
  );
}
