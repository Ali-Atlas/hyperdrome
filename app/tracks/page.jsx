import Link from 'next/link';
import NavShell from '@/components/ui/NavShell';
import { getAllTracks } from '@/services/track.service.js';
import { cn, getLevelColor, getDifficultyColor, getTrackNeon } from '@/lib/utils';
import styles from './page.module.css';

/* Server component - tracks are static game content, no interactivity
   needed on the index page beyond the click-through link. */
export default async function TracksPage() {
  const tracks = await getAllTracks();
  const sorted = [...tracks].sort(
    (a, b) => a.levelMin - b.levelMin || a.difficulty - b.difficulty,
  );

  return (
    <NavShell>
      <div className={styles.page}>
        <div className={styles.grid}>
          {sorted.map((track) => (
            <TrackCard key={track.id} track={track} />
          ))}
        </div>
      </div>
    </NavShell>
  );
}

function TrackCard({ track }) {
  const neon = getTrackNeon(track.name);
  return (
    <Link href={`/tracks/${track.id}`} className={styles.cardLink}>
      <article className={styles.card} style={{ '--track-neon': neon }}>
        <div className={styles.imageFrame}>
          <img
            src={track.imageUrl}
            alt={track.name}
            className={styles.trackImg}
          />
        </div>
        <div className={styles.body}>
          <h3 className={styles.name}>{track.name}</h3>
          <div className={styles.metaRow}>
            <LevelBracket min={track.levelMin} max={track.levelMax} />
            <DifficultyDots value={track.difficulty} />
          </div>
          <div className={styles.specs}>
            <Spec label="Straights" value={track.straights} />
            <SpecSep />
            <Spec label="Turns" value={track.turns} />
            <SpecSep />
            <Spec label="Length" value={track.length} upper />
          </div>
        </div>
      </article>
    </Link>
  );
}

/* ========================================================================== */
/* Shared level + difficulty + specs primitives (reused on detail page)       */
/* ========================================================================== */

export function LevelBracket({ min, max }) {
  return (
    <span
      className={styles.levelBracket}
      style={{
        '--level-from': getLevelColor(min),
        '--level-to': getLevelColor(max),
      }}
    >
      Lv {min}-{max}
    </span>
  );
}

export function DifficultyDots({ value }) {
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

function Spec({ label, value, upper }) {
  return (
    <span className={styles.spec}>
      <span className={styles.specLabel}>{label}</span>
      <span className={cn(styles.specValue, upper && styles.specUpper)}>
        {value}
      </span>
    </span>
  );
}

function SpecSep() {
  return <span className={styles.specSep} aria-hidden="true" />;
}
