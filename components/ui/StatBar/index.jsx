import { cn } from '@/lib/utils';
import styles from './StatBar.module.css';

/**
 * Horizontal stat bar with optional label + numeric value + fill.
 * When `label` is empty/null, the label column is omitted.
 * @param {object} props
 * @param {number} props.value
 * @param {number} [props.maxValue=100]
 * @param {string} [props.label]
 * @param {'sm'|'md'} [props.size='md']
 * @param {string} [props.className]
 */
export default function StatBar({
  value,
  maxValue = 100,
  label,
  size = 'md',
  className,
}) {
  const pct = Math.max(0, Math.min(100, (value / maxValue) * 100));
  return (
    <div
      className={cn(
        styles.row,
        styles[size],
        !label && styles.noLabel,
        className,
      )}
    >
      {label && <span className={styles.label}>{label}</span>}
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.value}>{value}</span>
    </div>
  );
}
