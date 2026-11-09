'use client';

import { useRef, useState } from 'react';
import styles from './page.module.css';

/** The drawing box; the SVG stretches it to its container (the race page's gap chart does the same). */
const W = 600;
const H = 160;
const PAD = 8;

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en-US');

/** @param {string} iso */
const clock = (iso) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

/**
 * @typedef {{ label: string, color: string, values: (number | null)[] }} Series
 */

/**
 * A line chart of one or more series over the snapshot times, in inline SVG with the app's CSS
 * variables. Only the first `visible` points are drawn (the replay grows it); the scales are set
 * from every point, so they hold still while it plays. Hover or touch shows each series' value.
 * @param {object} props
 * @param {Series[]} props.series
 * @param {string[]} props.times ISO time of each point
 * @param {number} props.visible points drawn, from the start
 * @param {string} props.label what the chart shows, for screen readers
 * @param {boolean} [props.fromZero] the y scale starts at 0
 * @param {boolean} [props.area] a light wash under a single series
 * @param {boolean} [props.legend] a legend row with each series' latest drawn value
 */
export default function EconomyChart({
  series,
  times,
  visible,
  label,
  fromZero = false,
  area = false,
  legend = false,
}) {
  const wrapRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [hover, setHover] = useState(/** @type {number | null} */ (null));
  const n = times.length;
  const shown = Math.max(0, Math.min(visible, n));

  const all = series.flatMap((s) => s.values.filter((v) => v !== null));
  if (n === 0 || all.length === 0) {
    return <p className={styles.chartEmpty}>Nothing recorded yet.</p>;
  }
  let lo = fromZero ? 0 : Math.min(...all);
  let hi = Math.max(...all);
  if (hi === lo) {
    hi += 1;
    if (!fromZero) lo -= 1;
  }
  const t0 = Date.parse(times[0]);
  const span = Math.max(1, Date.parse(times[n - 1]) - t0);
  const x = (/** @type {number} */ i) =>
    n === 1 ? W / 2 : ((Date.parse(times[i]) - t0) / span) * W;
  const y = (/** @type {number} */ v) => PAD + (1 - (v - lo) / (hi - lo)) * (H - 2 * PAD);

  /** @param {(number | null)[]} values @returns {string} */
  const linePath = (values) => {
    let d = '';
    let pen = false;
    for (let i = 0; i < shown; i += 1) {
      const v = values[i];
      if (v === null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  /** @param {(number | null)[]} values the last drawn index with a value */
  const lastIndex = (values) => {
    for (let i = shown - 1; i >= 0; i -= 1) if (values[i] !== null) return i;
    return -1;
  };

  /** @param {React.PointerEvent<HTMLDivElement>} e */
  const onMove = (e) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box || shown === 0) return;
    const at = t0 + ((e.clientX - box.left) / box.width) * span;
    let best = 0;
    for (let i = 1; i < shown; i += 1) {
      if (Math.abs(Date.parse(times[i]) - at) < Math.abs(Date.parse(times[best]) - at)) best = i;
    }
    setHover(best);
  };

  const pct = (/** @type {number} */ v, /** @type {number} */ max) => `${(v / max) * 100}%`;
  const hoverLeft = hover === null ? 0 : (x(hover) / W) * 100;

  return (
    <figure className={styles.chart} aria-label={label} role="img">
      {legend && (
        <div className={styles.legend} aria-hidden="true">
          {series.map((s) => {
            const last = lastIndex(s.values);
            return (
              <span key={s.label} className={styles.legendItem}>
                <span className={styles.legendSwatch} style={{ background: s.color }} />
                {s.label}
                <span className={styles.legendValue}>
                  {last >= 0 ? full.format(/** @type {number} */ (s.values[last])) : '-'}
                </span>
              </span>
            );
          })}
        </div>
      )}
      <div className={styles.chartRow} aria-hidden="true">
        <div className={styles.yAxis}>
          <span className={styles.yLabel} style={{ top: pct(y(hi), H) }}>
            {compact.format(hi)}
          </span>
          <span className={styles.yLabel} style={{ top: pct(y(lo), H) }}>
            {compact.format(lo)}
          </span>
        </div>
        <div
          ref={wrapRef}
          className={styles.plot}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <svg className={styles.svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <line x1="0" y1={y(hi)} x2={W} y2={y(hi)} className={styles.grid} />
            <line x1="0" y1={y(lo)} x2={W} y2={y(lo)} className={styles.grid} />
            {area && series.length === 1 && lastIndex(series[0].values) > 0 && (
              <path
                d={`${linePath(series[0].values)}L${x(lastIndex(series[0].values)).toFixed(1)},${H - PAD}L${x(series[0].values.findIndex((v) => v !== null)).toFixed(1)},${H - PAD}Z`}
                style={{ fill: series[0].color }}
                className={styles.area}
              />
            )}
            {series.map((s) => (
              <path
                key={s.label}
                d={linePath(s.values)}
                style={{ stroke: s.color }}
                className={styles.line}
              />
            ))}
            {hover !== null && (
              <line
                x1={x(hover)}
                y1={PAD}
                x2={x(hover)}
                y2={H - PAD}
                className={styles.crosshair}
              />
            )}
          </svg>
          {series.map((s) => {
            const last = lastIndex(s.values);
            if (last < 0) return null;
            return (
              <span
                key={s.label}
                className={styles.endDot}
                style={{
                  left: pct(x(last), W),
                  top: pct(y(/** @type {number} */ (s.values[last])), H),
                  background: s.color,
                }}
              />
            );
          })}
          {hover !== null && (
            <div
              className={styles.tooltip}
              style={{
                left: `${hoverLeft}%`,
                transform:
                  hoverLeft < 25
                    ? 'translateX(0)'
                    : hoverLeft > 75
                      ? 'translateX(-100%)'
                      : 'translateX(-50%)',
              }}
            >
              <div className={styles.tooltipHead}>{clock(times[hover])}</div>
              {series.map((s) => (
                <div key={s.label} className={styles.tooltipRow}>
                  <span className={styles.legendSwatch} style={{ background: s.color }} />
                  {s.label}
                  <span className={styles.legendValue}>
                    {s.values[hover] === null
                      ? '-'
                      : full.format(/** @type {number} */ (s.values[hover]))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={styles.xAxis} aria-hidden="true">
        <span>{clock(times[0])}</span>
        <span>{clock(times[n - 1])}</span>
      </div>
    </figure>
  );
}
