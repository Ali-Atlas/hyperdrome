'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import styles from './SkinThumb.module.css';

/**
 * Inline SVG fallback for skins that don't have a real image yet.
 * Rarity-tinted polygon. Was originally inlined in `app/marketplace/page.jsx`;
 * promoted here so it can be reused by `<SkinThumb>` and any direct caller.
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
    <svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`skin-${rarity}`} x1="0" x2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.18" />
          <stop offset="1" stopColor={color} stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <polygon
        points="20,70 55,25 105,25 140,70 120,80 40,80"
        fill={`url(#skin-${rarity})`}
        stroke={color}
        strokeWidth="1.5"
      />
      <line
        x1="55"
        y1="25"
        x2="40"
        y2="80"
        stroke={color}
        strokeWidth="1"
        opacity="0.5"
      />
      <line
        x1="105"
        y1="25"
        x2="120"
        y2="80"
        stroke={color}
        strokeWidth="1"
        opacity="0.5"
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
