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
              +{race.pointsAwarded} pts
            </span>
          </div>
        </header>

        {/* ---- Track card (full-width hero image) ---- */}
        <Card className={styles.trackCard}>
          <div className={styles.trackImage} aria-label="Track visualization">
            <TrackSvg track={race.track} />
          </div>
          <div className={styles.trackInfo}>
            <div className={styles.trackHead}>
              <h2 className={styles.trackName}>
                {race.track?.name ?? 'Unknown track'}
              </h2>
              <div className={styles.trackDifficulty}>
                Difficulty {race.track?.difficulty}/5
              </div>
            </div>
            <div className={styles.trackStats}>
              <TrackStat label="Straights" value={race.track?.straights ?? 0} />
              <TrackStat label="Turns" value={race.track?.turns ?? 0} />
              <TrackStat label="Length" value={race.track?.length ?? '—'} />
            </div>
          </div>
        </Card>

        {/* ---- Two drone cards below ---- */}
        <div className={styles.droneGrid}>
          <DroneCard
            drone={race.drone1}
            isWinner={race.drone1Id === winnerId}
            time={race.drone1Time}
          />
          <DroneCard
            drone={race.drone2}
            isWinner={race.drone2Id === winnerId}
            time={race.drone2Time}
          />
        </div>

        {/* ---- Race log (collapsible) ---- */}
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

function DroneCard({ drone, isWinner, time }) {
  if (!drone) {
    return <Card className={styles.droneCard}>Drone data missing</Card>;
  }

  const cardClass = `${styles.droneCard} ${isWinner ? styles.winnerCard : ''}`;

  return (
    <Link href={`/drones/${drone.id}`} className={styles.droneLink}>
      <Card className={cardClass}>
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
            <Badge variant="level" value={drone.level} />
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
  // Placeholder: a stylized racing line that roughly represents the track
  const straights = track?.straights ?? 5;
  const turns = track?.turns ?? 5;
  return (
    <svg
      viewBox="0 0 800 300"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="trackBg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#03DAC6" stopOpacity="0.08" />
          <stop offset="0.5" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#BB86FC" stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id="trackLine" x1="0" x2="1">
          <stop offset="0" stopColor="#03DAC6" stopOpacity="0.4" />
          <stop offset="0.5" stopColor="#03DAC6" stopOpacity="1" />
          <stop offset="1" stopColor="#03DAC6" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#trackBg)" />
      {/* Grid hint lines */}
      {Array.from({ length: 8 }).map((_, i) => (
        <line
          key={`g${i}`}
          x1={100 * i}
          y1="0"
          x2={100 * i}
          y2="300"
          stroke="#03DAC6"
          strokeOpacity="0.05"
        />
      ))}
      {/* Stylized track path */}
      <path
        d="M40,150 Q140,80 240,150 T440,150 T640,150 T760,150"
        fill="none"
        stroke="url(#trackLine)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {/* Start/finish markers */}
      <circle cx="40" cy="150" r="8" fill="#03DAC6" />
      <circle cx="760" cy="150" r="8" fill="#FFD700" />
      {/* Meta text */}
      <text
        x="40"
        y="270"
        fill="#03DAC6"
        fontFamily="JetBrains Mono, monospace"
        fontSize="14"
        letterSpacing="2"
      >
        {`${straights} STRAIGHTS  ·  ${turns} TURNS`}
      </text>
    </svg>
  );
}

