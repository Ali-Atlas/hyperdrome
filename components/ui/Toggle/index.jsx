'use client';

import { cn } from '@/lib/utils';
import styles from './Toggle.module.css';

/**
 * Accessible on/off toggle switch.
 * @param {object} props
 * @param {boolean} props.checked
 * @param {(next: boolean) => void} props.onChange
 * @param {boolean} [props.disabled]
 * @param {string} [props.label]
 * @param {string} [props.className]
 */
export default function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  className,
}) {
  const handleKeyDown = (event) => {
    if (disabled) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      onChange?.(!checked);
    }
  };

  return (
    <label className={cn(styles.wrapper, disabled && styles.disabled, className)}>
      {label && <span className={styles.label}>{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        onKeyDown={handleKeyDown}
        className={cn(styles.track, checked && styles.trackOn)}
      >
        <span className={cn(styles.knob, checked && styles.knobOn)} />
      </button>
    </label>
  );
}
