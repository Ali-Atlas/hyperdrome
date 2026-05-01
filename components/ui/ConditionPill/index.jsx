import {
  Sun,
  Cloud,
  CloudRain,
  CloudDrizzle,
  Wind,
  CloudFog,
  Sunrise,
  Sunset,
  Moon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from './ConditionPill.module.css';

const WEATHER_ICONS = {
  clear: Sun,
  clouds: Cloud,
  rain: CloudDrizzle,
  heavy_rain: CloudRain,
  wind: Wind,
  haze: Cloud,
  fog: CloudFog,
};

const TIME_ICONS = {
  dawn: Sunrise,
  day: Sun,
  dusk: Sunset,
  night: Moon,
};

const WEATHER_LABELS = {
  clear: 'Clear',
  clouds: 'Clouds',
  rain: 'Rain',
  heavy_rain: 'Heavy Rain',
  wind: 'Wind',
  haze: 'Haze',
  fog: 'Fog',
};

const TIME_LABELS = {
  dawn: 'Dawn',
  day: 'Day',
  dusk: 'Dusk',
  night: 'Night',
};

/**
 * Single source of truth for race weather + time-of-day badges across
 * the app (dashboard, races list, race detail, track detail, drone
 * detail). Renders nothing when `value` is missing so callers can pass
 * raw row values without gating.
 *
 * @param {object} props
 * @param {'weather'|'time'} props.kind
 * @param {string|null|undefined} props.value
 * @param {string} [props.className]
 */
export default function ConditionPill({ kind, value, className }) {
  if (!value) return null;
  const isWeather = kind === 'weather';
  const Icon = isWeather
    ? (WEATHER_ICONS[value] ?? Cloud)
    : (TIME_ICONS[value] ?? Sun);
  const label = isWeather
    ? (WEATHER_LABELS[value] ?? value)
    : (TIME_LABELS[value] ?? value);
  return (
    <span
      className={cn(
        styles.pill,
        styles[`pill_${kind}_${value}`],
        className,
      )}
    >
      <Icon size={10} aria-hidden="true" />
      <span>{label.toUpperCase()}</span>
    </span>
  );
}

/**
 * Inline row wrapper that renders both a weather and a time-of-day
 * pill side-by-side with a consistent gap. Use anywhere conditions
 * appear as a pair (table cells, stat values).
 *
 * @param {object} props
 * @param {string|null|undefined} props.weather
 * @param {string|null|undefined} props.timeOfDay
 * @param {string} [props.className]
 */
export function ConditionPillRow({ weather, timeOfDay, className }) {
  return (
    <span className={cn(styles.row, className)}>
      <ConditionPill kind="weather" value={weather} />
      <ConditionPill kind="time" value={timeOfDay} />
    </span>
  );
}
