import Link from 'next/link';
import { notFound } from 'next/navigation';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import {
  getTrackById,
  getTrackStats,
  getTopPerformersOnTrack,
  getRecentRacesOnTrack,
} from '@/services/track.service.js';
import {
  cn,
  getLevelColor,
  getDifficultyColor,
  getTrackNeon,
} from '@/lib/utils';
import styles from './page.module.css';

export default async function TrackDetailPage({ params }) {
  const { trackId } = await params;
  const track = await getTrackById(trackId);
  if (!track) notFound();

  const [trackStats, topPerformers, recentRaces] = await Promise.all([
    getTrackStats(trackId),
    getTopPerformersOnTrack(trackId),
    getRecentRacesOnTrack(trackId),
  ]);

  const neon = getTrackNeon(track.name);

  return (
    <NavShell>
      <div className={styles.page} style={{ '--track-neon': neon }}>
        {/* ---- Hero banner ---- */}
        <div className={styles.hero}>
          <div className={styles.neonStripe} aria-hidden="true" />
          <img
            src={track.imageUrl}
            alt={track.name}
            className={styles.heroImg}
          />
          <div className={styles.heroOverlay} aria-hidden="true" />
        </div>

        {/* ---- Title row: name + difficulty + level + specs ---- */}
        <div className={styles.titleRow}>
          <h1 className={styles.name}>{track.name}</h1>
          <div className={styles.titleMeta}>
            <LevelBracket min={track.levelMin} max={track.levelMax} />
            <DifficultyDots value={track.difficulty} />
            <Specs
              straights={track.straights}
              turns={track.turns}
              laps={track.laps}
              length={track.length}
            />
          </div>
        </div>

        {/* ---- Stats ---- */}
        <Card className={styles.sectionCard}>
          <h2 className={styles.sectionHead}>Track Stats</h2>
          <div className={styles.sectionBody}>
            {trackStats.totalRaces === 0 ? (
              <EmptyState
                title="No races recorded yet"
                description="Stats will populate once this track gets picked by the race engine."
              />
            ) : (
              <div className={styles.statGrid}>
                <StatCell label="Total Races" value={trackStats.totalRaces} />
                <StatCell
                  label="Avg Winning Time"
                  value={formatTime(trackStats.avgWinningTime)}
                />
                <StatCell
                  label="Track Record"
                  value={formatTime(trackStats.bestTime)}
                  sub={
                    trackStats.bestTimeDrone &&
                    `${trackStats.bestTimeDrone} · ${formatDate(
                      trackStats.bestTimeDate,
                    )}`
                  }
                />
                <StatCell
                  label="Most Common"
                  value={formatCondition(trackStats.topCondition)}
                />
              </div>
            )}
          </div>
        </Card>

        {/* ---- Top performers ---- */}
        <Card className={styles.sectionCard}>
          <h2 className={styles.sectionHead}>Top Performers</h2>
          <div className={styles.sectionBody}>
            {topPerformers.length === 0 ? (
              <EmptyState
                title="No qualifying racers yet"
                description="Drones need at least 3 races on this track to appear here."
              />
            ) : (
              <DataTable
                columns={[
                  {
                    key: 'rank',
                    label: '#',
                    align: 'left',
                    render: (r, i) => (
                      <span className={styles.rank}>{r.__rank}</span>
                    ),
                  },
                  {
                    key: 'name',
                    label: 'Drone',
                    render: (r) => (
                      <Link href={`/drones/${r.id}`} className={styles.droneLink}>
                        {r.name}
                      </Link>
                    ),
                  },
                  {
                    key: 'level',
                    label: 'Level',
                    shortLabel: 'Lv',
                    align: 'center',
                    render: (r) => <Badge variant="level" value={r.level} />,
                  },
                  {
                    key: 'wl',
                    label: 'W / L',
                    align: 'center',
                    render: (r) => (
                      <span className={styles.mono}>
                        {r.wins} / {r.losses}
                      </span>
                    ),
                  },
                  {
                    key: 'winRate',
                    label: 'Win Rate',
                    align: 'right',
                    render: (r) => (
                      <span className={styles.mono}>
                        {Math.round(r.winRate * 100)}%
                      </span>
                    ),
                  },
                ]}
                data={topPerformers.map((r, i) => ({ ...r, __rank: i + 1 }))}
              />
            )}
          </div>
        </Card>

        {/* ---- Recent races ---- */}
        <Card className={styles.sectionCard}>
          <h2 className={styles.sectionHead}>Recent Races</h2>
          <div className={styles.sectionBody}>
            {recentRaces.length === 0 ? (
              <EmptyState
                title="No races yet"
                description="Races on this track will show here as they finish."
              />
            ) : (
              <DataTable
                columns={[
                  {
                    key: 'at',
                    label: 'Date',
                    shortLabel: 'When',
                    render: (r) => (
                      <Link
                        href={`/races/${r.id}`}
                        className={cn(styles.mono, styles.raceLink)}
                      >
                        {formatDate(r.at)}
                      </Link>
                    ),
                  },
                  {
                    key: 'matchup',
                    label: 'Matchup',
                    render: (r) => (
                      <span className={styles.matchup}>
                        <span
                          className={cn(
                            styles.matchupName,
                            r.winnerDroneId === r.drone1.id && styles.winnerName,
                          )}
                        >
                          {r.drone1.name}
                        </span>
                        <span className={styles.vs}>vs</span>
                        <span
                          className={cn(
                            styles.matchupName,
                            r.winnerDroneId === r.drone2.id && styles.winnerName,
                          )}
                        >
                          {r.drone2.name}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: 'winner',
                    label: 'Winner',
                    render: (r) => (
                      <span className={styles.winnerTag}>
                        {r.winnerDroneId === r.drone1.id
                          ? r.drone1.name
                          : r.winnerDroneId === r.drone2.id
                            ? r.drone2.name
                            : '-'}
                      </span>
                    ),
                  },
                  {
                    key: 'conditions',
                    label: 'Conditions',
                    shortLabel: 'Cond.',
                    render: (r) => (
                      <span className={styles.conditions}>
                        {capitalize(r.timeOfDay)} · {formatWeather(r.weather)}
                      </span>
                    ),
                  },
                  {
                    key: 'points',
                    label: 'V',
                    align: 'right',
                    render: (r) => (
                      <span className={styles.mono}>{r.pointsAwarded}</span>
                    ),
                  },
                ]}
                data={recentRaces}
              />
            )}
          </div>
        </Card>
      </div>
    </NavShell>
  );
}

/* ------------------------------------------------------------ helpers --- */

function StatCell({ label, value, sub }) {
  return (
    <div className={styles.statCell}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value ?? '-'}</div>
      {sub && <div className={styles.statSub}>{sub}</div>}
    </div>
  );
}

function Specs({ straights, turns, laps, length }) {
  return (
    <span className={styles.specs}>
      <span className={styles.spec}>
        <span className={styles.specLabel}>Straights</span>
        <span className={styles.specValue}>{straights}</span>
      </span>
      <span className={styles.specSep} aria-hidden="true" />
      <span className={styles.spec}>
        <span className={styles.specLabel}>Turns</span>
        <span className={styles.specValue}>{turns}</span>
      </span>
      <span className={styles.specSep} aria-hidden="true" />
      <span className={styles.spec}>
        <span className={styles.specLabel}>Laps</span>
        <span className={styles.specValue}>{laps}</span>
      </span>
      <span className={styles.specSep} aria-hidden="true" />
      <span className={styles.spec}>
        <span className={styles.specLabel}>Length</span>
        <span className={cn(styles.specValue, styles.specUpper)}>{length}</span>
      </span>
    </span>
  );
}

function LevelBracket({ min, max }) {
  return (
    <span
      className={styles.levelBracket}
      style={{
        '--level-from': getLevelColor(min),
        '--level-to': getLevelColor(max),
      }}
    >
      LV {min}-{max}
    </span>
  );
}

function DifficultyDots({ value }) {
  const v = Math.max(0, Math.min(10, Number(value) || 0));
  const color = getDifficultyColor(v);
  return (
    <span
      className={styles.difficultyDots}
      aria-label={`Difficulty ${v} of 10`}
      style={{ '--diff-color': color }}
    >
      <span className={styles.dotsTrack} aria-hidden="true">
        {Array.from({ length: 10 }).map((_, i) => (
          <span
            key={i}
            className={cn(styles.dot, i < v && styles.dotOn)}
          />
        ))}
      </span>
      <span className={styles.diffScore}>{v}/10</span>
    </span>
  );
}

function formatTime(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return null;
  return `${Number(seconds).toFixed(2)}s`;
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatCondition(c) {
  if (!c) return '-';
  return `${capitalize(c.timeOfDay)} · ${formatWeather(c.weather)}`;
}

function formatWeather(w) {
  if (!w) return '';
  return w
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
