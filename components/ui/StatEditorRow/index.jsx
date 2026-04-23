'use client';

import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from './StatEditorRow.module.css';

/**
 * One stat row for the drone management editor.
 * Layout mirrors the dashboard's read-only .statRow (label | meter | value)
 * and appends an adjacent [−][+] control group. The meter fill + value both
 * track the live edited value so the bar and number update as the user
 * increments.
 *
 * @param {object} props
 * @param {string} props.statName
 * @param {number} props.currentValue
 * @param {number} props.baseValue
 * @param {number} props.maxValue
 * @param {number} props.pointsAvailable
 * @param {() => void} props.onIncrement
 * @param {() => void} props.onDecrement
 * @param {number} props.costToUpgrade
 * @param {boolean} [props.readOnly] - hides the +/- controls entirely.
 *   Used on the shared drone detail page for non-owners, where the same
 *   layout renders but the viewer has no authority to edit.
 * @param {string} [props.className]
 */
export default function StatEditorRow({
  statName,
  currentValue,
  baseValue,
  maxValue,
  pointsAvailable,
  onIncrement,
  onDecrement,
  costToUpgrade,
  readOnly,
  className,
}) {
  const plusDisabled =
    currentValue >= maxValue || pointsAvailable < costToUpgrade;
  const minusDisabled = currentValue <= baseValue;
  const hasDelta = currentValue > baseValue;

  const fillPct = Math.max(
    0,
    Math.min(100, (currentValue / maxValue) * 100),
  );

  return (
    <div className={cn(styles.row, hasDelta && styles.rowEdited, className)}>
      <span className={styles.name}>{statName}</span>

      <div className={styles.meter} aria-hidden="true">
        <div className={styles.meterFill} style={{ width: `${fillPct}%` }} />
      </div>

      <span className={styles.value}>{currentValue}</span>

      {!readOnly && (
        <div className={styles.btnGroup}>
          <button
            type="button"
            className={styles.btn}
            disabled={minusDisabled}
            onClick={onDecrement}
            aria-label={`Decrease ${statName}`}
          >
            <Minus size={14} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            className={styles.btn}
            disabled={plusDisabled}
            onClick={onIncrement}
            aria-label={`Increase ${statName}`}
          >
            <Plus size={14} strokeWidth={2.5} />
          </button>
        </div>
      )}
    </div>
  );
}
