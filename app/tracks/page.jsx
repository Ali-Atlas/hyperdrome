'use client';

import { useEffect, useMemo, useState } from 'react';
import NavShell from '@/components/ui/NavShell';
import { cn, getLevelColor, getDifficultyColor, getTrackNeon } from '@/lib/utils';
import styles from './page.module.css';

const BRACKETS = [
  { id: 'all', label: 'All' },
  { id: '1-5', label: 'LV 1-5', min: 1, max: 5 },
  { id: '6-10', label: 'LV 6-10', min: 6, max: 10 },
  { id: '11-15', label: 'LV 11-15', min: 11, max: 15 },
  { id: '16-20', label: 'LV 16-20', min: 16, max: 20 },
];

export default function TracksPage() {
  const [tracks, setTracks] = useState([]);
  const [bracket, setBracket] = useState('all');

  useEffect(() => {
    fetch('/api/tracks')
      .then((r) => r.json())
      .then((body) => {
        if (body?.data) setTracks(body.data);
      })
      .catch(() => {});
  }, []);

  const sorted = useMemo(
    () =>
      [...tracks].sort(
        (a, b) => a.levelMin - b.levelMin || a.difficulty - b.difficulty,
      ),
    [tracks],
  );

  const filtered = useMemo(() => {
    if (bracket === 'all') return sorted;
    const b = BRACKETS.find((x) => x.id === bracket);
    if (!b) return sorted;
    return sorted.filter(
      (t) => t.levelMin <= b.max && t.levelMax >= b.min,
    );
  }, [sorted, bracket]);

  const totalCount = tracks.length;
  const overallMin =
    tracks.length > 0 ? Math.min(...tracks.map((t) => t.levelMin)) : null;
  const overallMax =
    tracks.length > 0 ? Math.max(...tracks.map((t) => t.levelMax)) : null;

  return (
    <NavShell>
      <div className={styles.page}>
        <div className={styles.summary}>
          <span className={styles.summaryCount}>
            {totalCount} {totalCount === 1 ? 'TRACK' : 'TRACKS'}
          </span>
          {overallMin != null && overallMax != null && (
            <>
              <span className={styles.summaryDot} aria-hidden="true">
                ·
              </span>
              <span className={styles.summaryRange}>
                LV {overallMin} — LV {overallMax}
              </span>
            </>
          )}
          <span className={styles.summaryDot} aria-hidden="true">
            ·
          </span>
          <span className={styles.summaryIntro}>
            Race circuits across all difficulty levels
          </span>
        </div>

        <div className={styles.bracketBar} role="tablist">
          {BRACKETS.map((b) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={bracket === b.id}
              className={cn(
                styles.bracketTab,
                bracket === b.id && styles.bracketTabActive,
              )}
              onClick={() => setBracket(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>

        <div className={styles.grid}>
          {filtered.map((track) => (
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
          <Spec label="Laps" value={track.laps} />
          <SpecSep />
          <Spec label="Length" value={track.length} upper />
        </div>
      </div>
    </article>
  );
}

/* ========================================================================== */
/* Shared level + difficulty + specs primitives                                */
/* ========================================================================== */

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
