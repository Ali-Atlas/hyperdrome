import { cn } from '@/lib/utils';
import styles from './ModPlaceholder.module.css';

/**
 * Hexagonal circuit-chip placeholder for a mod. Reads as "hardware
 * component": flat hexagon outline with a few PCB-trace lines etched
 * inside it. Border + traces are rarity-colored; fill is a low-opacity
 * tint of the same color.
 *
 * `rarity` selects color via the .rarity_<rarity> class.
 *
 * @param {object} props
 * @param {'common'|'rare'|'epic'|'legendary'} props.rarity
 * @param {number} [props.size=120] - width + height in px
 * @param {string} [props.className]
 */
export default function ModPlaceholder({
  rarity = 'common',
  size = 120,
  className,
}) {
  // Regular hexagon centered on (50, 50), pointy-side oriented horizontally
  // (flat top/bottom). Vertices: top-left, top-right, right, bottom-right,
  // bottom-left, left. Slight inset from viewBox edges so glow has room.
  const hex = '15 26 50 8 85 26 85 64 50 82 15 64';

  return (
    <svg
      className={cn(styles.chip, styles[`rarity_${rarity}`], className)}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <polygon
        points={hex}
        fill="currentColor"
        fillOpacity="0.12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />

      {/* Inner contour for depth - slightly smaller hex, thinner stroke */}
      <polygon
        points="22 30 50 16 78 30 78 60 50 74 22 60"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="0.5"
        strokeLinejoin="round"
      />

      {/* Circuit traces - geometric lines + node dots, all in currentColor */}
      <g
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="square"
        fill="currentColor"
      >
        {/* Top horizontal trace with right turn */}
        <polyline
          points="30 36 44 36 44 44 56 44"
          fill="none"
        />
        {/* Bottom horizontal trace with left turn */}
        <polyline
          points="70 56 56 56 56 48 44 48"
          fill="none"
        />
        {/* Left vertical trace */}
        <polyline points="32 30 32 50 38 50" fill="none" />
        {/* Right diagonal trace */}
        <polyline points="68 30 68 40 60 40" fill="none" />
        {/* Center bus line */}
        <line x1="50" y1="58" x2="50" y2="68" />

        {/* Node dots */}
        <circle cx="30" cy="36" r="1.5" />
        <circle cx="70" cy="56" r="1.5" />
        <circle cx="32" cy="30" r="1.5" />
        <circle cx="68" cy="30" r="1.5" />
        <circle cx="50" cy="68" r="1.5" />
        <circle cx="56" cy="44" r="1.5" />
        <circle cx="44" cy="48" r="1.5" />
      </g>

      {/* Two small contact pads bottom-center to read as "pluggable" */}
      <g fill="currentColor" fillOpacity="0.6">
        <rect x="44" y="78" width="4" height="3" />
        <rect x="52" y="78" width="4" height="3" />
      </g>
    </svg>
  );
}
