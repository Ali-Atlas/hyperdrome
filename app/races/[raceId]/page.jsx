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
  ArrowLeft,
  Trophy,
  ChevronDown,
} from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
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

const TIME_ICONS = {
  dawn: Sunrise,
  day: Sun,
  dusk: Sunset,
  night: Moon,
};

/**
 * Race detail page. Unwraps async params (Next 16) via React.use().
 * Identity-focused design: track on top, two drone cards below, no stat bars.
 */
export default function RaceDetailPage({ params }) {
  const { raceId } = use(params);
  const [race, setRace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [logOpen, setLogOpen] = useState(false);

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
          <Skeleton variant="card" height={280} />
          <div className={styles.droneGrid}>
            <Skeleton variant="card" height={260} />
            <Skeleton variant="card" height={260} />
          </div>
        </div>
      </NavShell>
    );
  }

  if (error || !race) {
    return (
      <NavShell>
        <div className={styles.page}>
          <Link href="/races" className={styles.back}>
            <ArrowLeft size={16} /> Back to races
          </Link>
          <p className={styles.error}>{error || 'Race not found'}</p>
        </div>
      </NavShell>
    );
  }

  const WeatherIcon = WEATHER_ICONS[race.weather] ?? Cloud;
  const TimeIcon = TIME_ICONS[race.timeOfDay] ?? Sun;
  const winnerId = race.winnerDroneId;
  const raceLevel = race.drone1?.level ?? race.drone2?.level ?? null;

  return (
    <NavShell>
      <div className={styles.page}>
        <Link href="/races" className={styles.back}>
          <ArrowLeft size={16} /> Back to races
        </Link>

        {/* ---- Header ---- */}
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>
              Race #{race.id.slice(-8).toUpperCase()}
            </h1>
            <p className={styles.meta}>
              {new Date(race.createdAt).toLocaleString()}
            </p>
          </div>
          <div className={styles.conditions}>
            <span className={styles.conditionChip}>
              <WeatherIcon size={16} />
              {race.weather.replace('_', ' ')}
            </span>
            <span className={styles.conditionChip}>
              <TimeIcon size={16} />
              {race.timeOfDay}
            </span>
            <span className={styles.pointsChip}>
              {race.pointsAwarded} pts
            </span>
          </div>
        </header>

        <div className={styles.raceLayout}>
          <div className={styles.drone1Slot}>
            <DroneCard
              drone={race.drone1}
              isWinner={race.drone1Id === winnerId}
              time={race.drone1Time}
              level={raceLevel}
            />
          </div>
          <div className={styles.drone2Slot}>
            <DroneCard
              drone={race.drone2}
              isWinner={race.drone2Id === winnerId}
              time={race.drone2Time}
              level={raceLevel}
            />
          </div>

          <Card className={styles.trackCard}>
            <div className={styles.trackHeader}>
              <div className={styles.trackTitleRow}>
                <h2 className={styles.trackName}>
                  Track - {race.track?.name ?? 'Unknown track'}
                </h2>
                <div className={styles.trackDifficulty}>
                  Difficulty {race.track?.difficulty ?? '?'}/5
                </div>
              </div>
              <div className={styles.trackStats}>
                <TrackStat
                  label="Straights"
                  value={race.track?.straights ?? 0}
                />
                <TrackStatDivider />
                <TrackStat label="Turns" value={race.track?.turns ?? 0} />
                <TrackStatDivider />
                <TrackStat label="Length" value={race.track?.length ?? '—'} />
              </div>
            </div>
            <div className={styles.trackImage} aria-label="Track visualization">
              <TrackSvg track={race.track} />
            </div>
          </Card>

          <Card className={styles.logCard}>
            <button
              type="button"
              className={styles.logToggle}
              onClick={() => setLogOpen((v) => !v)}
              aria-expanded={logOpen}
            >
              <span>Race Log</span>
              <ChevronDown
                size={18}
                className={logOpen ? styles.logChevronOpen : styles.logChevron}
              />
            </button>
            {logOpen && (
              <div className={styles.logTable}>
                <div className={styles.logHeader}>
                  <span>#</span>
                  <span>Segment</span>
                  <span className={styles.alignRight}>
                    {race.drone1?.name ?? 'Drone 1'}
                  </span>
                  <span className={styles.alignRight}>
                    {race.drone2?.name ?? 'Drone 2'}
                  </span>
                  <span className={styles.alignCenter}>Lead</span>
                </div>
                {(race.raceLog ?? []).map((seg) => {
                  const lead = seg.drone1Time <= seg.drone2Time ? 1 : 2;
                  return (
                    <div key={seg.segment} className={styles.logRow}>
                      <span className={styles.mono}>{seg.segment}</span>
                      <span className={styles.segType}>{seg.type}</span>
                      <span className={`${styles.mono} ${styles.alignRight}`}>
                        {Number(seg.drone1Time).toFixed(2)}s
                      </span>
                      <span className={`${styles.mono} ${styles.alignRight}`}>
                        {Number(seg.drone2Time).toFixed(2)}s
                      </span>
                      <span
                        className={`${styles.alignCenter} ${
                          lead === 1 ? styles.lead1 : styles.lead2
                        }`}
                      >
                        {lead === 1 ? '◀' : '▶'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

      </div>
    </NavShell>
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

function DroneCard({ drone, isWinner, time, level }) {
  if (!drone) {
    return <Card className={styles.droneCard}>Drone data missing</Card>;
  }

  return (
    <Link href={`/drones/${drone.id}`} className={styles.droneLink}>
      <Card className={styles.droneCard}>
        {isWinner && (
          <div className={styles.winnerBadge}>
            <Trophy size={14} /> Winner
          </div>
        )}
        <div className={styles.droneImageFrame}>
          <img
            src={drone.imageUrl || '/drones/default.png'}
            alt={drone.name}
            className={styles.droneImg}
          />
        </div>
        <div className={styles.droneBody}>
          <div className={styles.droneHead}>
            <h3 className={styles.droneName}>{drone.name}</h3>
            <Badge variant="level" value={level ?? drone.level} />
          </div>
          <div className={styles.droneOwner}>
            Owner: {drone.userId ? drone.userId.slice(0, 8) : 'Bot'}
          </div>
          <div className={styles.droneMeta}>
            <span>
              <span className={styles.metaLabel}>ELO</span>
              <span className={styles.metaValue}>{drone.eloRating}</span>
            </span>
            <span>
              <span className={styles.metaLabel}>Time</span>
              <span className={styles.metaValue}>
                {time != null ? `${Number(time).toFixed(2)}s` : '—'}
              </span>
            </span>
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
  // Build a rounded-rectangle circuit with extra internal chicanes based on
  // the turn count. Deterministic via seed.
  const rand = mulberry32(seed);
  const margin = 60;
  const w = 800;
  const h = 200;
  const r = 40 + Math.floor(rand() * 20);

  const x1 = margin;
  const y1 = margin;
  const x2 = w - margin;
  const y2 = h - margin;

  // Base circuit is a rounded rectangle with corners (4 corners).
  // Additional turns add chicanes along the top straight.
  const extraTurns = Math.max(0, turns - 4);
  const chicaneCount = Math.min(extraTurns, 5);

  let path = `M ${x1 + r} ${y1}`;
  // Top straight with optional chicanes
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

