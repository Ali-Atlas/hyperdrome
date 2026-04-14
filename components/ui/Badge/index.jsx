import { cn, getLevelTier } from '@/lib/utils';
import styles from './Badge.module.css';

/**
 * Small inline-flex badge used for rarity, status, and level markers.
 * When variant is 'level', the badge background/text colour is driven by
 * the level tier (steel / teal / violet / gold).
 * @param {object} props
 * @param {'rarity'|'status'|'level'} props.variant
 * @param {string|number} props.value
 * @param {string} [props.className]
 */
export default function Badge({ variant, value, className }) {
  let modifier = null;
  let label;

  if (variant === 'level') {
    const level = Number(value) || 0;
    modifier = getLevelTier(level);
    label = `Lv ${level}`;
  } else if (variant === 'rarity' || variant === 'status') {
    modifier = String(value).toLowerCase();
    label = String(value).toUpperCase();
  } else {
    label = String(value).toUpperCase();
  }

  return (
    <span
      className={cn(
        styles.badge,
        styles[variant],
        modifier && styles[modifier],
        className,
      )}
    >
      {label}
    </span>
  );
}
