'use client';

import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from './StatEditorRow.module.css';

const SEGMENTS = 5;

/**
 * One stat row for the drone management screen.
 * Renders name + value + minus + delta + plus + 5-tier segmented blocks.
 * Highlights itself with a teal-tinted fill when there's a pending delta
 * (no left-border accent — uses background + full border per design rule).
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
  className,
}) {
  const plusDisabled =
    currentValue >= maxValue || pointsAvailable < costToUpgrade;
  const minusDisabled = currentValue <= baseValue;
  const hasDelta = currentValue > baseValue;

  const filled = Math.max(
    0,
    Math.min(SEGMENTS, Math.round((currentValue / maxValue) * SEGMENTS)),
  );

  return (
    <div className={cn(styles.row, hasDelta && styles.rowEdited, className)}>
      <span className={styles.name}>{statName}</span>

      <span className={styles.value}>{currentValue}</span>

      <button
        type="button"
        className={styles.btn}
        disabled={minusDisabled}
        onClick={onDecrement}
        aria-label={`Decrease ${statName}`}
      >
        <Minus size={14} strokeWidth={2.5} />
      </button>

      <span className={styles.deltaSlot}>
        {hasDelta && (
          <span className={styles.delta}>
            {baseValue} <span className={styles.arrow}>→</span> {currentValue}
          </span>
        )}
      </span>

      <button
        type="button"
        className={styles.btn}
        disabled={plusDisabled}
        onClick={onIncrement}
        aria-label={`Increase ${statName}`}
      >
        <Plus size={14} strokeWidth={2.5} />
      </button>

      <div className={styles.segments} aria-hidden="true">
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <span
            key={i}
            className={cn(styles.segment, i < filled && styles.segmentFilled)}
          />
        ))}
      </div>
    </div>
  );
}
