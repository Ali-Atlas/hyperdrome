import { cn } from '@/lib/utils';
import styles from './PlayerAvatar.module.css';

/**
 * Generic person silhouette used as the default player avatar everywhere.
 * Renders an inline SVG of a head + shoulders outline at 15% opacity in
 * `var(--text-tertiary)`. The caller's `className` controls the size via
 * the bounding box (typically a square frame), so the SVG inherits it.
 *
 * Future work: swap in a per-user avatar (NFT, social pic, upload). For
 * now every player gets this placeholder.
 *
 * @param {object} props
 * @param {string} [props.className]
 * @param {string} [props.ariaLabel]
 */
export default function PlayerAvatar({ className, ariaLabel }) {
  return (
    <svg
      className={cn(styles.svg, className)}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={ariaLabel || 'Player avatar'}
    >
      <g fill="var(--text-tertiary)" opacity="0.15">
        {/* Head */}
        <circle cx="50" cy="36" r="18" />
        {/* Shoulders / torso arc */}
        <path d="M 16 96 C 18 72, 36 60, 50 60 C 64 60, 82 72, 84 96 Z" />
      </g>
    </svg>
  );
}
