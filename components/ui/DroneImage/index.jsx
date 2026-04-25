'use client';

import { useState } from 'react';
import { getDroneImage } from '@/lib/utils';
import DronePlaceholder from '../DronePlaceholder';

/**
 * Drop-in replacement for `<img src={getDroneImage(drone)}>`. Resolves the
 * tier silhouette / skin / custom image via getDroneImage, and on load
 * failure swaps to a `<DronePlaceholder>` tinted in the drone's level
 * color so we never fall back to broken-image icon + alt text.
 *
 * The caller's `className` (typically the page's `.droneImg` class) is
 * passed straight through, so the placeholder inherits the same width /
 * height the image would have used.
 *
 * @param {object} props
 * @param {object} props.drone - drone payload (may include level, appliedSkin, imageUrl)
 * @param {string} [props.alt]
 * @param {string} [props.className]
 */
export default function DroneImage({ drone, alt, className, ...rest }) {
  const src = getDroneImage(drone);
  const [errored, setErrored] = useState(false);
  // Track src across renders so we re-attempt the load when the caller
  // swaps drones (dashboard spotlight cycling, marketplace pagination)
  // without paying for an effect + re-render. Standard React pattern for
  // "reset state on prop change."
  const [trackedSrc, setTrackedSrc] = useState(src);
  if (src !== trackedSrc) {
    setTrackedSrc(src);
    setErrored(false);
  }

  if (errored) {
    return (
      <DronePlaceholder
        level={drone?.level ?? 1}
        className={className}
        ariaLabel={alt ?? drone?.name ?? 'Drone'}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt ?? drone?.name ?? 'Drone'}
      className={className}
      onError={() => setErrored(true)}
      {...rest}
    />
  );
}
