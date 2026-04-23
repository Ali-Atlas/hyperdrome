'use client';

import { useMemo } from 'react';
import styles from './StatRadar.module.css';

const SIZE = 200;
const CENTER = SIZE / 2;
const RADIUS = 78;
const GRID_LEVELS = [0.25, 0.5, 0.75, 1];

/**
 * N-axis radar chart visualising a drone's stat shape at a glance.
 * By default renders a distribution — the largest stat reaches the
 * outer ring, others scale proportionally — so the shape reflects
 * where points have been allocated, not how many. Pass `maxValue`
 * to render on an absolute scale instead.
 *
 * @param {object} props
 * @param {string[]} props.axes
 * @param {Record<string, number>} props.stats
 * @param {number} [props.maxValue]
 * @param {string[]} [props.labels]
 * @param {string} [props.className]
 */
export default function StatRadar({ axes, stats, maxValue, labels, className }) {
  const angles = useMemo(
    () => axes.map((_, i) => ((i * (360 / axes.length) - 90) * Math.PI) / 180),
    [axes],
  );

  const effectiveMax = useMemo(() => {
    if (maxValue != null && maxValue > 0) return maxValue;
    const values = axes.map((k) => stats[k] ?? 0);
    const m = Math.max(...values, 0);
    return m > 0 ? m : 1;
  }, [axes, stats, maxValue]);

  const point = (level, angle) => ({
    x: CENTER + level * RADIUS * Math.cos(angle),
    y: CENTER + level * RADIUS * Math.sin(angle),
  });

  const gridPolygons = GRID_LEVELS.map((level) =>
    angles
      .map((a) => {
        const p = point(level, a);
        return `${p.x},${p.y}`;
      })
      .join(' '),
  );

  const axisEndpoints = angles.map((a) => point(1, a));

  const dataPoints = axes.map((key, i) => {
    const value = stats[key] ?? 0;
    const level = Math.max(0, Math.min(1, value / effectiveMax));
    return point(level, angles[i]);
  });

  const dataPolyPoints = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');

  const labelPoints = angles.map((a) => point(1.18, a));

  const className_ = [styles.radar, className].filter(Boolean).join(' ');

  return (
    <svg
      className={className_}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      aria-hidden="true"
    >
      {gridPolygons.map((pts, i) => (
        <polygon key={i} points={pts} className={styles.grid} />
      ))}
      {axisEndpoints.map((p, i) => (
        <line
          key={i}
          x1={CENTER}
          y1={CENTER}
          x2={p.x}
          y2={p.y}
          className={styles.axis}
        />
      ))}
      <polygon points={dataPolyPoints} className={styles.dataFill} />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.5} className={styles.dataDot} />
      ))}
      {labels &&
        labels.map((text, i) => (
          <text
            key={i}
            x={labelPoints[i].x}
            y={labelPoints[i].y}
            className={styles.label}
            textAnchor={textAnchorFor(angles[i])}
            dominantBaseline="middle"
          >
            {text}
          </text>
        ))}
    </svg>
  );
}

function textAnchorFor(angle) {
  const cos = Math.cos(angle);
  if (cos > 0.15) return 'start';
  if (cos < -0.15) return 'end';
  return 'middle';
}
