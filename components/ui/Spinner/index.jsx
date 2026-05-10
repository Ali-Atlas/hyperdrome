import styles from './Spinner.module.css';

/**
 * Compact loading indicator: teal-stroke circular spinner sized to fit
 * inline with body text or as the sole occupant of an empty container
 * while a fetch is in flight. Pure CSS - no JS animation work, no layout
 * thrashing.
 *
 * @param {object} [props]
 * @param {'sm'|'md'|'lg'} [props.size='md'] - controls the diameter.
 *   sm = 16px (inline next to text), md = 28px (default for empty
 *   container slots), lg = 44px (full-card placeholder).
 * @param {string} [props.label] - optional caption displayed below the
 *   spinner. Use for slower fetches where the user benefits from a
 *   "Loading X..." cue.
 * @param {string} [props.className] - extra class on the wrapper, e.g.
 *   to position the wrapper inside its container.
 */
export default function Spinner({ size = 'md', label, className }) {
  const sizeClass =
    size === 'sm' ? styles.sm : size === 'lg' ? styles.lg : styles.md;
  const wrapClass = [styles.wrap, className].filter(Boolean).join(' ');
  return (
    <div className={wrapClass} role="status" aria-live="polite">
      <span className={`${styles.spinner} ${sizeClass}`} aria-hidden="true" />
      {label && <span className={styles.label}>{label}</span>}
      {!label && <span className={styles.srOnly}>Loading</span>}
    </div>
  );
}
