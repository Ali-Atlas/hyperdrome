import { cn } from '@/lib/utils';
import styles from './ModPlaceholder.module.css';

/**
 * Hexagonal circuit-chip placeholder for a mod. Reads as "hardware
 * component": a flat regular hexagon with a symmetric set of straight
 * PCB-style traces inside it. Border + traces are rarity-colored;
 * fill is a low-opacity tint of the same color.
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
  // Pointy-top regular hexagon centered on (50, 50). Vertices: top,
  // upper-right, lower-right, bottom, lower-left, upper-left.
  const hex = '50 10 86 30 86 70 50 90 14 70 14 30';
  const innerHex = '50 22 76 36 76 64 50 78 24 64 24 36';

  return (
    <svg
      className={cn(styles.chip, styles[`rarity_${rarity}`], className)}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      {/* Outer hex - filled tint + outlined */}
      <polygon
        points={hex}
        fill="currentColor"
        fillOpacity="0.12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />

      {/* Inner contour - visual depth */}
      <polygon
        points={innerHex}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="0.5"
        strokeLinejoin="round"
      />

      {/* Symmetric PCB traces: an H-network with a vertical spine.
          Two parallel verticals (left + right) join via a horizontal
          mid-bus, and a vertical center bus runs through the same
          mid-point. All endpoints terminate at contact dots. The
          design is mirror-symmetric across both x=50 and y=50. */}
      <g
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="square"
      >
        {/* Left vertical */}
        <line x1="34" y1="34" x2="34" y2="66" />
        {/* Right vertical */}
        <line x1="66" y1="34" x2="66" y2="66" />
        {/* Horizontal mid-bus connecting the two verticals */}
        <line x1="34" y1="50" x2="66" y2="50" />
        {/* Vertical spine */}
        <line x1="50" y1="34" x2="50" y2="66" />
      </g>

      {/* Contact dots at the four corner terminals + center node */}
      <g fill="currentColor">
        <circle cx="34" cy="34" r="1.8" />
        <circle cx="66" cy="34" r="1.8" />
        <circle cx="34" cy="66" r="1.8" />
        <circle cx="66" cy="66" r="1.8" />
        <circle cx="50" cy="50" r="1.6" />
      </g>
    </svg>
  );
}
