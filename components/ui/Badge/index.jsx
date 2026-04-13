import { cn } from '@/lib/utils';
import styles from './Badge.module.css';

/**
 * Small inline-flex badge used for rarity, status, and level markers.
 * @param {object} props
 * @param {'rarity'|'status'|'level'} props.variant
 * @param {string|number} props.value
 * @param {string} [props.className]
 */
export default function Badge({ variant, value, className }) {
  const modifier = variant === 'rarity' || variant === 'status' ? String(value).toLowerCase() : null;
  return (
    <span
      className={cn(
        styles.badge,
        styles[variant],
        modifier && styles[modifier],
        className,
      )}
    >
      {variant === 'level' ? `LVL ${value}` : String(value).toUpperCase()}
    </span>
  );
}
