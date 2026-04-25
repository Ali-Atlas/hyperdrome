import { cn, getLevelColor } from '@/lib/utils';
import styles from './DronePlaceholder.module.css';

/**
 * Inline SVG quadcopter silhouette used as the fallback when a drone
 * image fails to load or doesn't exist. Filled in the level-tier color
 * at 15% opacity so the shape reads against any card background.
 *
 * Sized 100% / 100% by default so it matches the bounding box of the
 * `<img>` it replaces — the caller's frame controls the actual render
 * size, not this component.
 *
 * @param {object} props
 * @param {number} [props.level=1]
 * @param {string} [props.className]
 * @param {string} [props.ariaLabel]
 */
export default function DronePlaceholder({ level = 1, className, ariaLabel }) {
  const color = getLevelColor(level);
  return (
    <svg
      className={cn(styles.svg, className)}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={ariaLabel || 'Drone silhouette'}
    >
      <g fill={color} opacity="0.15">
        {/* Four rotor circles at the corners */}
        <circle cx="22" cy="22" r="13" />
        <circle cx="78" cy="22" r="13" />
        <circle cx="22" cy="78" r="13" />
        <circle cx="78" cy="78" r="13" />
        {/* X-shaped arms connecting body to rotors */}
        <rect x="46" y="14" width="8" height="72" rx="3" transform="rotate(45 50 50)" />
        <rect x="46" y="14" width="8" height="72" rx="3" transform="rotate(-45 50 50)" />
        {/* Central body */}
        <rect x="38" y="38" width="24" height="24" rx="5" />
      </g>
    </svg>
  );
}
