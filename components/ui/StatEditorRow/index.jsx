'use client';

import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import StatBar from '../StatBar';
import styles from './StatEditorRow.module.css';

/**
 * One stat row for the drone management screen.
 * Parent owns the current/base/cost math — this component just renders it.
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

  return (
    <div className={cn(styles.row, className)}>
      <div className={styles.header}>
        <span className={styles.label}>{statName}</span>
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.btn}
            disabled={minusDisabled}
            onClick={onDecrement}
            aria-label={`Decrease ${statName}`}
          >
            <Minus size={14} />
          </button>
          <span className={styles.value}>{currentValue}</span>
          <button
            type="button"
            className={styles.btn}
            disabled={plusDisabled}
            onClick={onIncrement}
            aria-label={`Increase ${statName}`}
          >
            <Plus size={14} />
          </button>
          <span className={styles.cost}>
            {plusDisabled && currentValue >= maxValue
              ? '(max)'
              : `(cost ${costToUpgrade})`}
          </span>
        </div>
      </div>

      <StatBar value={currentValue} maxValue={maxValue} size="sm" />

      {hasDelta && (
        <span className={styles.delta}>
          {baseValue} → {currentValue}
        </span>
      )}
    </div>
  );
}
