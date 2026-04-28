'use client';

import { useEffect, useMemo, useState } from 'react';
import NavShell from '@/components/ui/NavShell';
import TrackPlaceholder from '@/components/tracks/TrackPlaceholder';
import { cn, getDifficultyColor, getTrackNeon } from '@/lib/utils';
import styles from './page.module.css';

const BRACKETS = [
  { id: 'all', label: 'All' },
  { id: '1-5', label: 'LV 1-5', min: 1, max: 5 },
  { id: '6-10', label: 'LV 6-10', min: 6, max: 10 },
  { id: '11-15', label: 'LV 11-15', min: 11, max: 15 },
  { id: '16-20', label: 'LV 16-20', min: 16, max: 20 },
];

/** Slugs of tracks that have a final rendered image at /tracks/<slug>.webp.
 *  Tracks not in this list render the holographic placeholder. */
const TRACKS_WITH_IMAGES = [
  'horizon-express',
  'neon-straightaway',
  'the-grid',
  'circuit-alpha',
  'keyhole',
  'meridian',
];

/** Per-track accent colors. Used by both the placeholder (wireframe +
 *  glow + name color) and could be wired to image-having cards later. */
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

/** Lowercase track name with whitespace -> single hyphen. */
function trackSlug(name) {
  return (name ?? '').toLowerCase().trim().replace(/\s+/g, '-');
}

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

  return (
    <NavShell>
      <div className={styles.page}>
        <div className={styles.summary}>
          <span className={styles.summaryCount}>
            {totalCount} {totalCount === 1 ? 'TRACK' : 'TRACKS'}
          </span>
        </div>

        <div className={styles.bracketBarWrap}>
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
  const slug = trackSlug(track.name);
  const hasImage = TRACKS_WITH_IMAGES.includes(slug);
  const accentColor = TRACK_ACCENT_COLORS[slug] ?? '#03DAC6';
  return (
    <article className={styles.card} style={{ '--track-neon': neon }}>
      <h3 className={styles.name}>{track.name}</h3>
      <div className={styles.imageFrame}>
        {hasImage ? (
          <img
            src={`/tracks/${slug.replace(/-/g, '_')}.webp`}
            alt={track.name}
            className={styles.trackImg}
          />
        ) : (
          <TrackPlaceholder
            trackName={track.name}
            accentColor={accentColor}
          />
        )}
      </div>
      <div className={styles.body}>
        <div className={styles.metaRow}>
          <Difficulty value={track.difficulty} />
          <LevelText min={track.levelMin} max={track.levelMax} />
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

function LevelText({ min, max }) {
  return (
    <span className={styles.metaItem}>
      <span className={styles.metaLabel}>Level</span>
      <span className={styles.levelValue}>
        LV {min}-{max}
      </span>
    </span>
  );
}

function Difficulty({ value }) {
  const v = Math.max(0, Math.min(10, Number(value) || 0));
  const color = getDifficultyColor(v);
  return (
    <span
      className={styles.metaItem}
      aria-label={`Difficulty ${v} of 10`}
      style={{ '--diff-color': color }}
    >
      <span className={styles.metaLabel}>Difficulty</span>
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
