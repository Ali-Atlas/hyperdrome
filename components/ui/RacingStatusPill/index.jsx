import { cn } from '@/lib/utils';
import styles from './RacingStatusPill.module.css';

/**
 * Shared LIVE / RACING PAUSED indicator for the racing-engine state.
 * Used everywhere this state surfaces in the UI so the visual is
 * identical across pages.
 *
 *  - Active (default):  teal background tint, teal pulsing dot, "LIVE".
 *  - Paused:            transparent background, amber dot, "RACING PAUSED".
 *
 * @param {object} props
 * @param {boolean} [props.paused]
 * @param {string} [props.className]
 */
export default function RacingStatusPill({ paused = false, className }) {
  return (
    <div className={cn(styles.box, paused && styles.boxPaused, className)}>
      <span
        className={cn(styles.dot, paused && styles.dotPaused)}
        aria-hidden="true"
      />
      <span className={styles.label}>
        {paused ? 'RACING PAUSED' : 'LIVE'}
      </span>
    </div>
  );
}
