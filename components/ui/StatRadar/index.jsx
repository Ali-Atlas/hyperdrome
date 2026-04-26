'use client';

import { useMemo, useState } from 'react';
import styles from './StatRadar.module.css';

const SIZE = 200;
const CENTER = SIZE / 2;
const RADIUS = 78;
const GRID_LEVELS = [0.25, 0.5, 0.75, 1];

/** Default abbreviations + display names for the standard 9 drone stats.
 *  Used when a caller doesn't pass a `labels` prop, so the radar renders
 *  consistent apex labels and tooltip rows everywhere it appears. */
const DEFAULT_ABBR = {
  speed: 'SPD',
  turning: 'TRN',
  acceleration: 'ACC',
  durability: 'DUR',
  nightVision: 'NV',
  batteryCapacity: 'BAT',
  rainHandling: 'RAIN',
  windResistance: 'WIND',
  consistency: 'CST',
};

const DEFAULT_DISPLAY = {
  speed: 'Speed',
  turning: 'Turning',
  acceleration: 'Acceleration',
  durability: 'Durability',
  nightVision: 'Night Vision',
  batteryCapacity: 'Battery',
  rainHandling: 'Rain',
  windResistance: 'Wind',
  consistency: 'Consistency',
};

function abbrFor(axis) {
  return DEFAULT_ABBR[axis] ?? axis.slice(0, 3).toUpperCase();
}

function displayFor(axis) {
  if (DEFAULT_DISPLAY[axis]) return DEFAULT_DISPLAY[axis];
  return axis.charAt(0).toUpperCase() + axis.slice(1).replace(/([A-Z])/g, ' $1');
}

/**
 * N-axis radar chart visualising a drone's stat shape at a glance.
 * By default renders a distribution - the largest stat reaches the
 * outer ring, others scale proportionally - so the shape reflects
 * where points have been allocated, not how many. Pass `maxValue`
 * to render on an absolute scale instead.
 *
 * Apex labels render unconditionally; hover the chart to see a
 * tooltip with each stat's full name + numeric value.
 *
 * Pass `compareStats` (e.g. the opponent's stat object) to color the
 * tooltip values: teal when own > compare, red when own < compare,
 * default text color when equal or compare is unset.
 *
 * `tone` controls the data polygon's color treatment:
 *   'own'      - teal accent (default; current drone-management visual)
 *   'opponent' - desaturated grey for matchup comparisons where a
 *                second radar shouldn't compete with the primary one.
 *
 * @param {object} props
 * @param {string[]} props.axes
 * @param {Record<string, number>} props.stats
 * @param {Record<string, number>} [props.compareStats]
 * @param {number} [props.maxValue]
 * @param {string[]} [props.labels]
 * @param {string} [props.className]
 * @param {'own'|'opponent'} [props.tone='own']
 */
export default function StatRadar({
  axes,
  stats,
  compareStats,
  maxValue,
  labels,
  className,
  tone = 'own',
}) {
  const [hovered, setHovered] = useState(false);

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

  const labelPoints = angles.map((a) => point(1.22, a));
  const apexLabels = useMemo(
    () => (labels && labels.length === axes.length ? labels : axes.map(abbrFor)),
    [axes, labels],
  );

  const tooltipRows = useMemo(
    () =>
      axes.map((axis) => {
        const own = stats[axis] ?? 0;
        const compare = compareStats ? compareStats[axis] ?? 0 : null;
        let cmp = null;
        if (compare !== null) {
          if (own > compare) cmp = 'win';
          else if (own < compare) cmp = 'loss';
          else cmp = 'tie';
        }
        return { name: displayFor(axis), value: own, cmp };
      }),
    [axes, stats, compareStats],
  );

  const wrapperClass = [styles.wrapper, className].filter(Boolean).join(' ');
  const radarClass = [
    styles.radar,
    tone === 'opponent' ? styles.radarOpponent : null,
  ]
    .filter(Boolean)
    .join(' ');
  const fillClass =
    tone === 'opponent' ? styles.dataFillOpponent : styles.dataFill;
  const dotClass =
    tone === 'opponent' ? styles.dataDotOpponent : styles.dataDot;

  return (
    <div
      className={wrapperClass}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      tabIndex={0}
    >
      <svg
        className={radarClass}
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
        <polygon points={dataPolyPoints} className={fillClass} />
        {dataPoints.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} className={dotClass} />
        ))}
        {apexLabels.map((text, i) => (
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
      {hovered && (
        <div className={styles.tooltip} role="tooltip">
          <table className={styles.tooltipTable}>
            <tbody>
              {tooltipRows.map((row) => (
                <tr key={row.name}>
                  <td className={styles.tooltipName}>{row.name}</td>
                  <td
                    className={[
                      styles.tooltipValue,
                      row.cmp === 'win' && styles.tooltipValueWin,
                      row.cmp === 'loss' && styles.tooltipValueLoss,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {row.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function textAnchorFor(angle) {
  const cos = Math.cos(angle);
  if (cos > 0.15) return 'start';
  if (cos < -0.15) return 'end';
  return 'middle';
}
