import { cn } from '@/lib/utils';
import styles from './VoltIcon.module.css';

/**
 * Inline lightning-bolt currency icon for Volts.
 *
 * Renders a clean geometric bolt as an inline SVG. Default color is
 * `var(--accent-primary)` via the CSS module; the `<path>` uses
 * `currentColor` so callers can override by setting `color` on the
 * icon (via a passed className or `style={{ color: ... }}`).
 *
 * @param {object} props
 * @param {number} [props.size=14] - width + height in px
 * @param {string} [props.className]
 * @param {object} [props.style]
 */
export default function VoltIcon({ size = 14, className, style }) {
  return (
    <svg
      className={cn(styles.icon, className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      <path d="M13 2 L3 14 h9 l-1 8 10-12 h-9 l1-8 z" />
    </svg>
  );
}
