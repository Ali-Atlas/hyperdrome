'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import styles from './CountdownTimer.module.css';

/**
 * Displays HH:MM:SS counting down to `targetDate`. Updates every second.
 * @param {object} props
 * @param {string|Date} props.targetDate
 * @param {string} [props.label]
 * @param {string} [props.expiredLabel='Racing now...']
 * @param {string} [props.className]
 */
export default function CountdownTimer({
  targetDate,
  label,
  expiredLabel = 'Racing now...',
  className,
}) {
  const computeRemaining = () => {
    const target =
      typeof targetDate === 'string' ? new Date(targetDate) : targetDate;
    return Math.max(0, target.getTime() - Date.now());
  };

  const [remaining, setRemaining] = useState(computeRemaining);

  useEffect(() => {
    setRemaining(computeRemaining());
    const id = setInterval(() => setRemaining(computeRemaining()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetDate]);

  if (remaining <= 0) {
    return (
      <div className={cn(styles.wrapper, className)}>
        {label && <span className={styles.label}>{label}</span>}
        <span className={styles.expired}>{expiredLabel}</span>
      </div>
    );
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');

  return (
    <div className={cn(styles.wrapper, className)}>
      {label && <span className={styles.label}>{label}</span>}
      <span className={styles.time}>
        <span>{hours}</span>
        <span className={styles.colon}>:</span>
        <span>{minutes}</span>
        <span className={styles.colon}>:</span>
        <span key={seconds} className={styles.secondsPulse}>
          {seconds}
        </span>
      </span>
    </div>
  );
}
