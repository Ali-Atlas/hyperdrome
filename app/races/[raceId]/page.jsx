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
} from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import StatBar from '@/components/ui/StatBar';
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

const STAT_LABELS = [
  ['speed', 'Speed'],
  ['turning', 'Turning'],
  ['acceleration', 'Acceleration'],
  ['durability', 'Durability'],
  ['nightVision', 'Night Vision'],
  ['batteryCapacity', 'Battery'],
  ['rainHandling', 'Rain Handling'],
  ['windResistance', 'Wind Resist.'],
  ['consistency', 'Consistency'],
];

/**
 * Race detail page. Unwraps the async params (Next 16) via React.use().
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
          <Skeleton variant="text" width="50%" />
          <div className={styles.grid}>
            <Skeleton variant="card" height={400} />
            <Skeleton variant="card" height={400} />
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

        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Race #{race.id.slice(-8).toUpperCase()}</h1>
            <p className={styles.meta}>
              {new Date(race.createdAt).toLocaleString()} · {race.track?.name}
            </p>
          </div>
          <div className={styles.conditions}>
            <span className={styles.conditionIcon} title={race.weather}>
              <WeatherIcon size={22} /> {race.weather}
            </span>
            <span className={styles.conditionIcon} title={race.timeOfDay}>
              <TimeIcon size={22} /> {race.timeOfDay}
            </span>
          </div>
        </header>

        <div className={styles.grid}>
          <DroneCard drone={race.drone1} isWinner={race.drone1Id === winnerId} time={race.drone1Time} />
          <DroneCard drone={race.drone2} isWinner={race.drone2Id === winnerId} time={race.drone2Time} />
        </div>

        <Card className={styles.trackCard}>
          <h2 className={styles.sectionHeading}>Track</h2>
          <div className={styles.trackInfo}>
            <div>
              <div className={styles.trackName}>{race.track?.name}</div>
              <div className={styles.trackSpec}>
                {race.track?.straights} straights · {race.track?.turns} turns · {race.track?.length}
              </div>
            </div>
            <div className={styles.difficulty}>
              Difficulty {race.track?.difficulty}/5
            </div>
          </div>
        </Card>

        <Card className={styles.logCard}>
          <h2 className={styles.sectionHeading}>Race Log</h2>
          <div className={styles.logTable}>
            <div className={styles.logHeader}>
              <span>#</span>
              <span>Segment</span>
              <span>{race.drone1?.name ?? 'Drone 1'}</span>
              <span>{race.drone2?.name ?? 'Drone 2'}</span>
              <span>Lead</span>
            </div>
            {(race.raceLog ?? []).map((seg) => {
              const lead = seg.drone1Time <= seg.drone2Time ? 1 : 2;
              return (
                <div key={seg.segment} className={styles.logRow}>
                  <span className={styles.mono}>{seg.segment}</span>
                  <span>{seg.type}</span>
                  <span className={styles.mono}>{Number(seg.drone1Time).toFixed(2)}s</span>
                  <span className={styles.mono}>{Number(seg.drone2Time).toFixed(2)}s</span>
                  <span
                    className={lead === 1 ? styles.lead1 : styles.lead2}
                    aria-label={`Leader drone ${lead}`}
                  >
                    {lead === 1 ? '◀' : '▶'}
                  </span>
                </div>
              );
            })}
          </div>
          <div className={styles.rewards}>
            <span>Winner +{race.xpWinner} XP, +{race.pointsAwarded} pts</span>
            <span>Loser +{race.xpLoser} XP</span>
          </div>
        </Card>
      </div>
    </NavShell>
  );
}

function DroneCard({ drone, isWinner, time }) {
  if (!drone) return <Card className={styles.droneCard}>Drone data missing</Card>;
  return (
    <Card className={`${styles.droneCard} ${isWinner ? styles.winnerCard : ''}`}>
      {isWinner && (
        <div className={styles.winnerBadge}>
          <Trophy size={14} /> Winner
        </div>
      )}
      <div className={styles.droneHeader}>
        <h2 className={styles.droneName}>{drone.name}</h2>
        <Badge variant="level" value={drone.level} />
      </div>
      <div className={styles.droneMeta}>
        <span>ELO {drone.eloRating}</span>
        <span>
          W {drone.wins} / L {drone.losses}
        </span>
        <span className={styles.mono}>{time != null ? `${Number(time).toFixed(2)}s` : '—'}</span>
      </div>
      <div className={styles.stats}>
        {STAT_LABELS.map(([key, label]) => (
          <StatBar
            key={key}
            label={label}
            value={drone[key]}
            maxValue={100}
            size="sm"
          />
        ))}
      </div>
    </Card>
  );
}
