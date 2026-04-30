'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import styles from './SkinThumb.module.css';

/**
 * Inline SVG fallback for skins that don't have a real image yet.
 * Folded-pentagon prism: open-envelope-pointing-down silhouette with
 * 5 outer corners (top-left, top-right, mid-right, bottom apex,
 * mid-left) plus a back-wall facet and two flap polygons that read
 * as a folded surface. Same shape used as the marketplace-local
 * skin placeholder; promoted here so marketplace, bind modal, and
 * pack opening all share one source.
 *
 * @param {object} props
 * @param {'common'|'rare'|'epic'|'legendary'} [props.rarity]
 */
export function SkinMini({ rarity = 'common' }) {
  const colors = {
    common: '#9E9E9E',
    rare: '#4A9EFF',
    epic: '#BB86FC',
    legendary: '#FFD700',
  };
  const color = colors[rarity] ?? colors.common;
  return (
    <svg
      viewBox="0 0 200 158"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Back wall facet (between the two folds). */}
      <polygon
        points="14,14 186,14 100,148"
        fill={color}
        fillOpacity="0.22"
      />
      {/* Left flap. */}
      <polygon
        points="14,14 18,108 100,148"
        fill={color}
        fillOpacity="0.10"
      />
      {/* Right flap - mirror of the left. */}
      <polygon
        points="186,14 182,108 100,148"
        fill={color}
        fillOpacity="0.10"
      />
      {/* Outer pentagon: top edge slightly inset; mid corners pulled
          ~5% outward at y=108 so the bottom flares a touch wider. */}
      <path
        d="M 14,14 L 186,14 L 182,108 L 100,148 L 18,108 Z"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeOpacity="0.7"
        strokeLinejoin="round"
      />
      {/* V fold lines from the top corners to the apex. */}
      <line
        x1="14" y1="14" x2="100" y2="148"
        stroke={color} strokeWidth="1.5" strokeOpacity="0.7"
      />
      <line
        x1="186" y1="14" x2="100" y2="148"
        stroke={color} strokeWidth="1.5" strokeOpacity="0.7"
      />
    </svg>
  );
}

/**
 * Renders a skin's optimized webp if one exists at the imageUrl path,
 * otherwise falls back to the rarity-tinted `<SkinMini>` SVG.
 *
 * Sizing is delegated to the caller via className (matches DroneImage's
 * pattern). The image is `object-fit: contain` so different aspect ratios
 * stay centered in their slot.
 *
 * @param {object} props
 * @param {object} [props.skin] - skin payload (with imageUrl + rarity)
 * @param {'common'|'rare'|'epic'|'legendary'} [props.rarity] - fallback
 *   rarity used when there's no skin or when the image fails to load
 * @param {string} [props.alt]
 * @param {string} [props.className]
 */
export default function SkinThumb({ skin, rarity, alt, className }) {
  const fallbackRarity = skin?.rarity ?? rarity ?? 'common';
  const url = skin?.imageUrl;
  const isRealImage = typeof url === 'string' && url.startsWith('/skins/') && url.endsWith('.webp');
  const [errored, setErrored] = useState(false);
  const [trackedUrl, setTrackedUrl] = useState(url);
  if (url !== trackedUrl) {
    setTrackedUrl(url);
    setErrored(false);
  }

  if (!isRealImage || errored) {
    return (
      <span className={cn(styles.wrap, className)} aria-hidden={alt ? undefined : 'true'}>
        <SkinMini rarity={fallbackRarity} />
      </span>
    );
  }

  return (
    <span className={cn(styles.wrap, className)}>
      <img
        src={url}
        alt={alt ?? skin?.name ?? 'Skin'}
        className={styles.img}
        onError={() => setErrored(true)}
      />
    </span>
  );
}
