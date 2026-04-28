import styles from './TrackPlaceholder.module.css';

/**
 * Holographic track motif: a dim oval wireframe in the track's accent
 * color with a faint glow and the track name centered in the same accent.
 * Used for tracks rendered without a photographic preview.
 *
 * Pure CSS + inline SVG, no external dependencies. The accent color is
 * passed through a CSS custom property (`--track-accent`) so the wireframe,
 * its glow, and the track name all read from a single value.
 *
 * @param {object} props
 * @param {string} props.trackName   - track name displayed in the center
 * @param {string} props.accentColor - CSS color string used for the
 *   wireframe stroke, glow, and track-name color
 */
export default function TrackPlaceholder({ trackName, accentColor }) {
  return (
    <div
      className={styles.placeholder}
      style={{ '--track-accent': accentColor }}
      role="img"
      aria-label={trackName}
    >
      <svg
        className={styles.outline}
        viewBox="0 0 200 100"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <ellipse
          cx="100"
          cy="50"
          rx="78"
          ry="34"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="3 4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className={styles.label}>
        <div className={styles.name}>{trackName}</div>
      </div>
    </div>
  );
}
