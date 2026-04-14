'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import NavShell from '@/components/ui/NavShell';
import DataTable from '@/components/ui/DataTable';
import FilterBar from '@/components/ui/FilterBar';
import CountdownTimer from '@/components/ui/CountdownTimer';
import { getLevelColor } from '@/lib/utils';
import styles from './page.module.css';

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

const WEATHER_OPTIONS = [
  { value: 'clear', label: 'Clear' },
  { value: 'clouds', label: 'Clouds' },
  { value: 'rain', label: 'Rain' },
  { value: 'heavy_rain', label: 'Heavy Rain' },
  { value: 'wind', label: 'Wind' },
  { value: 'haze', label: 'Haze' },
  { value: 'fog', label: 'Fog' },
];

const TIME_OF_DAY_OPTIONS = [
  { value: 'dawn', label: 'Dawn' },
  { value: 'day', label: 'Day' },
  { value: 'dusk', label: 'Dusk' },
  { value: 'night', label: 'Night' },
];

const LEVEL_BRACKET_OPTIONS = [
  { value: '1-5',   label: '1–5' },
  { value: '6-10',  label: '6–10' },
  { value: '11-15', label: '11–15' },
  { value: '16-20', label: '16–20' },
];

function shortId(id) {
  return id ? `#${id.slice(-8).toUpperCase()}` : '#—';
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/** Parse a "1-5" bracket string into [min, max]. */
function parseBracket(b) {
  if (!b) return null;
  const [lo, hi] = b.split('-').map(Number);
  return [lo, hi];
}

export default function RacesPage() {
  const router = useRouter();
  const [data, setData] = useState({ items: [], total: 0 });
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({});
  const [search, setSearch] = useState('');
  const [nextRaceAt, setNextRaceAt] = useState(null);
  const [racingPaused, setRacingPaused] = useState(false);
  const limit = 20;

  const fetchRaces = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (filters.weather) params.set('weather', filters.weather);
    if (filters.time_of_day) params.set('time_of_day', filters.time_of_day);
    if (filters.track_id) params.set('track_id', filters.track_id);
    try {
      const res = await fetch(`/api/races?${params.toString()}`);
      const body = await res.json();
      if (body?.data) {
        setData({ items: body.data.items ?? [], total: body.data.total ?? 0 });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  const fetchNextRace = useCallback(async () => {
    try {
      const res = await fetch('/api/races/next');
      const body = await res.json();
      if (body?.data) {
        setRacingPaused(Boolean(body.data.paused));
        setNextRaceAt(body.data.nextRaceAt ?? null);
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  const fetchTracks = useCallback(async () => {
    try {
      const res = await fetch('/api/tracks');
      const body = await res.json();
      if (body?.data) setTracks(body.data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    fetchRaces();
  }, [fetchRaces]);

  useEffect(() => {
    fetchNextRace();
    const id = setInterval(fetchNextRace, 30_000);
    return () => clearInterval(id);
  }, [fetchNextRace]);

  useEffect(() => {
    fetchTracks();
  }, [fetchTracks]);

  useEffect(() => {
    const id = setInterval(fetchRaces, 30_000);
    return () => clearInterval(id);
  }, [fetchRaces]);

  const filteredItems = useMemo(() => {
    let items = data.items;
    const bracket = parseBracket(filters.drone_level);
    if (bracket) {
      const [lo, hi] = bracket;
      items = items.filter(
        (r) =>
          (r.drone1?.level >= lo && r.drone1?.level <= hi) ||
          (r.drone2?.level >= lo && r.drone2?.level <= hi),
      );
    }
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (r) =>
          r.drone1?.name?.toLowerCase().includes(q) ||
          r.drone2?.name?.toLowerCase().includes(q) ||
          r.track?.name?.toLowerCase().includes(q),
      );
    }
    return items;
  }, [data.items, search, filters.drone_level]);

  const columns = useMemo(
    () => [
      {
        key: 'id',
        label: 'ID',
        render: (row) => (
          <span className={styles.mono}>{shortId(row.id)}</span>
        ),
      },
      {
        key: 'createdAt',
        label: 'Date / Time',
        render: (row) => formatDate(row.createdAt),
      },
      {
        key: 'track',
        label: 'Track',
        render: (row) => row.track?.name ?? '—',
      },
      {
        key: 'weather',
        label: 'Wx',
        align: 'center',
        render: (row) => {
          const Icon = WEATHER_ICONS[row.weather] ?? Cloud;
          return (
            <span title={row.weather} className={styles.iconCell}>
              <Icon size={16} />
            </span>
          );
        },
      },
      {
        key: 'timeOfDay',
        label: 'Time',
        align: 'center',
        render: (row) => {
          const Icon = TIME_ICONS[row.timeOfDay] ?? Sun;
          return (
            <span title={row.timeOfDay} className={styles.iconCell}>
              <Icon size={16} />
            </span>
          );
        },
      },
      {
        key: 'drone1',
        label: 'Drone 1',
        render: (row) =>
          row.drone1 ? (
            <span className={styles.droneCell}>
              {row.drone1.name}
              <span
                className={styles.droneLv}
                style={{ color: getLevelColor(row.drone1.level) }}
              >
                {' '}Lv{row.drone1.level}
              </span>
            </span>
          ) : (
            '—'
          ),
      },
      {
        key: 'drone2',
        label: 'Drone 2',
        render: (row) =>
          row.drone2 ? (
            <span className={styles.droneCell}>
              {row.drone2.name}
              <span
                className={styles.droneLv}
                style={{ color: getLevelColor(row.drone2.level) }}
              >
                {' '}Lv{row.drone2.level}
              </span>
            </span>
          ) : (
            '—'
          ),
      },
      {
        key: 'winner',
        label: 'Winner',
        render: (row) => {
          const winner =
            row.winnerDroneId === row.drone1Id ? row.drone1 : row.drone2;
          return winner ? (
            <span className={styles.winner}>
              {winner.name}
              <span
                className={styles.winnerLv}
                style={{ color: getLevelColor(winner.level) }}
              >
                {' '}Lv{winner.level}
              </span>
            </span>
          ) : (
            '—'
          );
        },
      },
      {
        key: 'pointsAwarded',
        label: 'Pts',
        align: 'right',
        render: (row) => (
          <span className={styles.mono}>{row.pointsAwarded}</span>
        ),
      },
    ],
    [],
  );

  const trackOptions = useMemo(
    () => tracks.map((t) => ({ value: t.id, label: t.name })),
    [tracks],
  );

  const filterDefs = [
    { key: 'track_id', label: 'Track', type: 'select', options: trackOptions },
    {
      key: 'weather',
      label: 'Weather',
      type: 'select',
      options: WEATHER_OPTIONS,
    },
    {
      key: 'time_of_day',
      label: 'Time of Day',
      type: 'select',
      options: TIME_OF_DAY_OPTIONS,
    },
    {
      key: 'drone_level',
      label: 'Drone Level',
      type: 'select',
      options: LEVEL_BRACKET_OPTIONS,
    },
  ];

  const totalPages = Math.max(1, Math.ceil(data.total / limit));

  return (
    <NavShell>
      <div className={styles.page}>
        <FilterBar
          filters={filterDefs}
          values={filters}
          onChange={(key, value) =>
            setFilters((prev) => ({ ...prev, [key]: value }))
          }
          onSearch={setSearch}
          searchPlaceholder="Search drone or track..."
          className={styles.filterBar}
        />

        <DataTable
          columns={columns}
          data={filteredItems}
          loading={loading}
          emptyMessage="No races yet."
          onRowClick={(row) => router.push(`/races/${row.id}`)}
        />

        {totalPages > 1 && (
          <nav className={styles.pagination} aria-label="Pagination">
            <button
              type="button"
              className={styles.pageBtn}
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <span className={styles.pageInfo}>
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              className={styles.pageBtn}
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </nav>
        )}
      </div>
    </NavShell>
  );
}
