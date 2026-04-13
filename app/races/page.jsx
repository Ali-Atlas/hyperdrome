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

/**
 * Format a race's short ID display — last 6 chars of the UUID.
 */
function shortId(id) {
  return id ? `#${id.slice(-8).toUpperCase()}` : '#—';
}

/** Pretty-print an ISO timestamp. */
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export default function RacesPage() {
  const router = useRouter();
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({});
  const [search, setSearch] = useState('');
  const [nextRaceAt, setNextRaceAt] = useState(null);
  const limit = 20;

  const fetchRaces = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (filters.weather) params.set('weather', filters.weather);
    if (filters.time_of_day) params.set('time_of_day', filters.time_of_day);
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
      if (body?.data?.nextRaceAt) setNextRaceAt(body.data.nextRaceAt);
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

  // Auto-refresh race table every 30s
  useEffect(() => {
    const id = setInterval(fetchRaces, 30_000);
    return () => clearInterval(id);
  }, [fetchRaces]);

  const filteredItems = useMemo(() => {
    if (!search) return data.items;
    const q = search.toLowerCase();
    return data.items.filter(
      (r) =>
        r.drone1?.name?.toLowerCase().includes(q) ||
        r.drone2?.name?.toLowerCase().includes(q) ||
        r.track?.name?.toLowerCase().includes(q),
    );
  }, [data.items, search]);

  const columns = useMemo(
    () => [
      {
        key: 'id',
        label: 'Race ID',
        render: (row) => <span className={styles.mono}>{shortId(row.id)}</span>,
      },
      {
        key: 'createdAt',
        label: 'Date / Time',
        render: (row) => formatDate(row.createdAt),
      },
      {
        key: 'track',
        label: 'Track Name',
        render: (row) => row.track?.name ?? '—',
      },
      {
        key: 'weather',
        label: 'Weather',
        align: 'center',
        render: (row) => {
          const Icon = WEATHER_ICONS[row.weather] ?? Cloud;
          return (
            <span title={row.weather} className={styles.iconCell}>
              <Icon size={18} />
            </span>
          );
        },
      },
      {
        key: 'timeOfDay',
        label: 'Time of Day',
        align: 'center',
        render: (row) => {
          const Icon = TIME_ICONS[row.timeOfDay] ?? Sun;
          return (
            <span title={row.timeOfDay} className={styles.iconCell}>
              <Icon size={18} />
            </span>
          );
        },
      },
      {
        key: 'drone1',
        label: 'Drone 1',
        render: (row) =>
          row.drone1
            ? `${row.drone1.name} | Lvl ${row.drone1.level}`
            : '—',
      },
      {
        key: 'drone2',
        label: 'Drone 2',
        render: (row) =>
          row.drone2
            ? `${row.drone2.name} | Lvl ${row.drone2.level}`
            : '—',
      },
      {
        key: 'winner',
        label: 'Winner',
        render: (row) => {
          const winner =
            row.winnerDroneId === row.drone1Id ? row.drone1 : row.drone2;
          return winner ? (
            <span className={styles.winner}>
              {winner.name} | Lvl {winner.level}
            </span>
          ) : (
            '—'
          );
        },
      },
      {
        key: 'pointsAwarded',
        label: 'Points',
        align: 'right',
        render: (row) => <span className={styles.mono}>{row.pointsAwarded}</span>,
      },
    ],
    [],
  );

  const filterDefs = [
    { key: 'weather', label: 'Weather', type: 'select', options: WEATHER_OPTIONS },
    {
      key: 'time_of_day',
      label: 'Time of Day',
      type: 'select',
      options: TIME_OF_DAY_OPTIONS,
    },
  ];

  const totalPages = Math.max(1, Math.ceil(data.total / limit));

  return (
    <NavShell>
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Race Results</h1>
            <p className={styles.subtitle}>
              Total Races: {data.total.toLocaleString()} | Showing Recent
            </p>
          </div>
          <div className={styles.liveBox}>
            <div className={styles.liveIndicator}>
              <span className={styles.liveDot} />
              Live Now: {filteredItems.length} Races
            </div>
            {nextRaceAt && (
              <CountdownTimer
                targetDate={nextRaceAt}
                label="Next block"
                expiredLabel="Running..."
              />
            )}
          </div>
        </header>

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
          emptyMessage="No races yet. They start as soon as players activate drones."
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
