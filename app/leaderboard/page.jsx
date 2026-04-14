'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Trophy,
  Sparkles,
  Coins,
  Award,
  Search,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import { useSession } from '@/hooks/useSession';
import { cn, getLevelColor } from '@/lib/utils';
import styles from './page.module.css';

function daysRemaining(endIso) {
  if (!endIso) return 0;
  const ms = new Date(endIso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function seasonProgress(startIso, endIso) {
  if (!startIso || !endIso) return 0;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const now = Date.now();
  return Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100));
}

/* -------------------------------------------------------------------------- */

export default function LeaderboardPage() {
  const { user } = useSession();
  const [tab, setTab] = useState('players');
  const [items, setItems] = useState([]);
  const [season, setSeason] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'elo', order: 'desc' });
  const [myDroneIds, setMyDroneIds] = useState(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type: tab,
        sort_by: 'elo',
        limit: '100',
      });
      const res = await fetch(`/api/leaderboard?${params.toString()}`);
      const body = await res.json();
      if (body?.data) {
        setItems(body.data.items ?? []);
        setSeason(body.data.season ?? null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  const fetchMyDrones = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await fetch('/api/drones');
      const body = await res.json();
      if (body?.data) {
        setMyDroneIds(new Set(body.data.map((d) => d.id)));
      }
    } catch {
      /* noop */
    }
  }, [user?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchMyDrones();
  }, [fetchMyDrones]);

  const top3 = items.slice(0, 3);
  const rest = items.slice(3);

  const filteredRest = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = rest.map((row, idx) => ({ ...row, __rank: idx + 4 }));
    if (!q) return source;
    return source.filter((row) =>
      (row.username ?? row.name ?? '').toLowerCase().includes(q),
    );
  }, [rest, search]);

  const sortedRest = useMemo(() => {
    const copy = [...filteredRest];
    copy.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string')
        return sort.order === 'asc'
          ? av.localeCompare(bv)
          : bv.localeCompare(av);
      return sort.order === 'asc' ? av - bv : bv - av;
    });
    return copy;
  }, [filteredRest, sort]);

  const toggleSort = (key) => {
    setSort((prev) =>
      prev.key === key
        ? { key, order: prev.order === 'desc' ? 'asc' : 'desc' }
        : { key, order: 'desc' },
    );
  };

  const rowIsMine = (row) => {
    if (tab === 'players') return user?.id && row.id === user.id;
    return myDroneIds.has(row.id);
  };

  const columns = useMemo(() => {
    if (tab === 'players') {
      return [
        { key: '__rank', label: '#', sortable: false, align: 'left' },
        {
          key: 'username',
          label: 'Player',
          sortable: true,
          render: (row) => row.username || '—',
        },
        {
          key: 'winRateValue',
          label: 'Win Rate',
          sortable: true,
          align: 'right',
          value: (row) =>
            row.totalRaces > 0 ? row.totalWins / row.totalRaces : 0,
          render: (row) => {
            const rate =
              row.totalRaces > 0
                ? ((row.totalWins / row.totalRaces) * 100).toFixed(0) + '%'
                : '—';
            return rate;
          },
        },
        {
          key: 'totalWins',
          label: 'Wins',
          sortable: true,
          align: 'right',
        },
        {
          key: 'totalRaces',
          label: 'Races',
          sortable: true,
          align: 'right',
        },
        {
          key: 'eloRating',
          label: 'ELO',
          sortable: true,
          align: 'right',
          render: (row) => <span className={styles.mono}>{row.eloRating}</span>,
        },
        {
          key: 'seasonPoints',
          label: 'Season',
          sortable: true,
          align: 'right',
          render: (row) => (
            <span className={styles.mono}>{row.seasonPoints}</span>
          ),
        },
      ];
    }
    return [
      { key: '__rank', label: '#', sortable: false, align: 'left' },
      {
        key: 'name',
        label: 'Drone',
        sortable: true,
        render: (row) => (
          <span className={styles.droneNameCell}>
            {row.name}
            <span
              className={styles.droneLvSuffix}
              style={{ color: getLevelColor(row.level) }}
            >
              {' '}Lv{row.level}
            </span>
          </span>
        ),
      },
      {
        key: 'level',
        label: 'Level',
        sortable: true,
        align: 'right',
        render: (row) => <Badge variant="level" value={row.level} />,
      },
      {
        key: 'winRateValue',
        label: 'Win Rate',
        sortable: true,
        align: 'right',
        value: (row) => (row.totalRaces > 0 ? row.wins / row.totalRaces : 0),
        render: (row) => {
          const rate =
            row.totalRaces > 0
              ? ((row.wins / row.totalRaces) * 100).toFixed(0) + '%'
              : '—';
          return rate;
        },
      },
      { key: 'wins', label: 'Wins', sortable: true, align: 'right' },
      { key: 'totalRaces', label: 'Races', sortable: true, align: 'right' },
      {
        key: 'eloRating',
        label: 'ELO',
        sortable: true,
        align: 'right',
        render: (row) => <span className={styles.mono}>{row.eloRating}</span>,
      },
    ];
  }, [tab]);

  const rewards = (
    <Card className={styles.rewards}>
      <h2 className={styles.rewardsHeading}>Season Rewards Preview</h2>
      <div className={styles.rewardsGrid}>
        <div className={styles.rewardItem}>
          <Sparkles size={20} className={styles.rewardIcon} />
          <div className={styles.rewardLabel}>Exclusive Skins</div>
        </div>
        <div className={styles.rewardItem}>
          <Coins size={20} className={styles.rewardIcon} />
          <div className={styles.rewardLabel}>Point Prizes</div>
        </div>
        <div className={styles.rewardItem}>
          <Award size={20} className={styles.rewardIcon} />
          <div className={styles.rewardLabel}>Titles / Badges</div>
        </div>
      </div>
    </Card>
  );

  return (
    <NavShell>
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>Leaderboard</h1>
          {season && (
            <div className={styles.seasonBlock}>
              <div className={styles.seasonTitle}>
                Season {season.seasonNumber} · {daysRemaining(season.endDate)}d
                left
              </div>
              <div className={styles.progressTrack}>
                <div
                  className={styles.progressFill}
                  style={{
                    width: `${seasonProgress(season.startDate, season.endDate)}%`,
                  }}
                />
              </div>
            </div>
          )}
        </header>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'players'}
            className={cn(styles.tab, tab === 'players' && styles.tabActive)}
            onClick={() => setTab('players')}
          >
            Players
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'drones'}
            className={cn(styles.tab, tab === 'drones' && styles.tabActive)}
            onClick={() => setTab('drones')}
          >
            Drones
          </button>
        </div>

        {/* ---- Podium (horizontal scroll on mobile) ---- */}
        {loading ? (
          <div className={styles.podium}>
            <Skeleton variant="card" height={280} />
            <Skeleton variant="card" height={320} />
            <Skeleton variant="card" height={280} />
          </div>
        ) : (
          <Podium items={top3} tab={tab} />
        )}

        {/* ---- Season rewards (mobile-first order, CSS reorders on desktop) ---- */}
        <div className={styles.rewardsMobile}>{rewards}</div>

        {/* ---- Search + table ---- */}
        <div className={styles.tableToolbar}>
          <div className={styles.searchWrap}>
            <Search size={14} className={styles.searchIcon} aria-hidden="true" />
            <input
              type="search"
              className={styles.searchInput}
              placeholder={
                tab === 'players'
                  ? 'Search player...'
                  : 'Search drone...'
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {columns.map((col) => {
                  const isActive = sort.key === col.key;
                  return (
                    <th
                      key={col.key}
                      className={cn(
                        styles.th,
                        col.align && styles[`align${col.align}`],
                        col.sortable && styles.sortable,
                      )}
                      onClick={
                        col.sortable ? () => toggleSort(col.key) : undefined
                      }
                    >
                      <span className={styles.thContent}>
                        {col.label}
                        {col.sortable && isActive && (
                          sort.order === 'asc' ? (
                            <ChevronUp size={12} />
                          ) : (
                            <ChevronDown size={12} />
                          )
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedRest.length === 0 ? (
                <tr>
                  <td className={styles.empty} colSpan={columns.length}>
                    No results.
                  </td>
                </tr>
              ) : (
                sortedRest.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      styles.row,
                      rowIsMine(row) && styles.myRow,
                    )}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          styles.td,
                          col.align && styles[`align${col.align}`],
                        )}
                      >
                        {col.render ? col.render(row) : row[col.key]}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className={styles.rewardsDesktop}>{rewards}</div>
      </div>
    </NavShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Podium                                                                     */
/* -------------------------------------------------------------------------- */

function Podium({ items, tab }) {
  return (
    <div className={styles.podium}>
      <PodiumCard rank={2} entry={items[1] ?? null} tab={tab} />
      <PodiumCard rank={1} entry={items[0] ?? null} tab={tab} />
      <PodiumCard rank={3} entry={items[2] ?? null} tab={tab} />
    </div>
  );
}

function PodiumCard({ rank, entry, tab }) {
  const empty = !entry;
  const name = entry ? (tab === 'players' ? entry.username : entry.name) : null;
  const wins = entry ? (tab === 'players' ? entry.totalWins : entry.wins) : 0;
  const totalRaces = entry?.totalRaces ?? 0;
  const winRate =
    totalRaces > 0 ? ((wins / totalRaces) * 100).toFixed(0) + '%' : '—';
  const seasonPts = tab === 'players' ? entry?.seasonPoints : null;
  const imageUrl = entry?.imageUrl || '/drones/default.png';

  const rankClass =
    rank === 1 ? styles.gold : rank === 2 ? styles.silver : styles.bronze;

  return (
    <div
      className={cn(
        styles.podiumCard,
        rankClass,
        rank === 1 && styles.podiumFirst,
        empty && styles.podiumEmpty,
      )}
    >
      <div className={styles.podiumRankLabel}>
        <Trophy size={rank === 1 ? 20 : 16} /> {rank}
        {ordinal(rank)}
      </div>
      <div className={styles.podiumImageFrame}>
        <img src={imageUrl} alt={name ?? 'Unclaimed'} />
      </div>
      <div className={styles.podiumNameRow}>
        <div className={styles.podiumName}>{empty ? 'Unclaimed' : name}</div>
        {!empty && tab === 'drones' && entry.level != null && (
          <Badge variant="level" value={entry.level} />
        )}
      </div>
      <dl className={styles.podiumStats}>
        <StatRow label="Win Rate" value={empty ? '—' : winRate} />
        <StatRow label="Wins" value={empty ? '—' : wins} />
        <StatRow label="ELO" value={empty ? '—' : entry.eloRating} />
        {tab === 'players' && (
          <StatRow label="Season" value={empty ? '—' : seasonPts ?? 0} />
        )}
      </dl>
    </div>
  );
}

function StatRow({ label, value }) {
  return (
    <div className={styles.podiumStatRow}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ordinal(n) {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}
