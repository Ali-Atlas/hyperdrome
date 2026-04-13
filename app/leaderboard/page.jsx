'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trophy } from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import DataTable from '@/components/ui/DataTable';
import Card from '@/components/ui/Card';
import Skeleton from '@/components/ui/Skeleton';
import { useSession } from '@/hooks/useSession';
import styles from './page.module.css';

/** Days remaining between `start` and `end`, clamped non-negative. */
function daysRemaining(endIso) {
  if (!endIso) return 0;
  const ms = new Date(endIso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/** Percentage of the season elapsed. */
function seasonProgress(startIso, endIso) {
  if (!startIso || !endIso) return 0;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const now = Date.now();
  return Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100));
}

export default function LeaderboardPage() {
  const [tab, setTab] = useState('players');
  const [items, setItems] = useState([]);
  const [season, setSeason] = useState(null);
  const [loading, setLoading] = useState(true);
  const [myRank, setMyRank] = useState(null);
  const { user } = useSession();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type: tab, sort_by: 'elo', limit: '50' });
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

  const fetchMyRank = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await fetch('/api/leaderboard/me');
      const body = await res.json();
      if (body?.data) setMyRank(body.data);
    } catch (err) {
      console.error(err);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchMyRank();
  }, [fetchMyRank]);

  const top3 = items.slice(0, 3);
  const rest = items.slice(3);

  const columns = useMemo(() => {
    if (tab === 'players') {
      return [
        { key: 'rank', label: '#', align: 'left', render: (row) => <span className={styles.rankCell}>RANK #{row.__rank}</span> },
        { key: 'username', label: 'Player Name', render: (row) => row.username || '—' },
        {
          key: 'winRate',
          label: 'Win Rate',
          align: 'right',
          render: (row) => {
            const rate = row.totalRaces > 0 ? (row.totalWins / row.totalRaces) * 100 : 0;
            return `${rate.toFixed(0)}%`;
          },
        },
        { key: 'totalWins', label: 'Wins', align: 'right' },
        { key: 'totalRaces', label: 'Races', align: 'right' },
        {
          key: 'eloRating',
          label: 'ELO',
          align: 'right',
          render: (row) => <span className={styles.mono}>{row.eloRating}</span>,
        },
        {
          key: 'seasonPoints',
          label: 'Season Points',
          align: 'right',
          render: (row) => <span className={styles.mono}>{row.seasonPoints}</span>,
        },
      ];
    }
    return [
      { key: 'rank', label: '#', align: 'left', render: (row) => <span className={styles.rankCell}>RANK #{row.__rank}</span> },
      { key: 'name', label: 'Drone Name', render: (row) => row.name },
      { key: 'level', label: 'Level', align: 'right' },
      {
        key: 'winRate',
        label: 'Win Rate',
        align: 'right',
        render: (row) => {
          const rate = row.totalRaces > 0 ? (row.wins / row.totalRaces) * 100 : 0;
          return `${rate.toFixed(0)}%`;
        },
      },
      { key: 'wins', label: 'Wins', align: 'right' },
      { key: 'totalRaces', label: 'Races', align: 'right' },
      {
        key: 'eloRating',
        label: 'ELO',
        align: 'right',
        render: (row) => <span className={styles.mono}>{row.eloRating}</span>,
      },
    ];
  }, [tab]);

  const rankedRest = rest.map((row, idx) => ({ ...row, __rank: idx + 4 }));

  return (
    <NavShell>
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>Leaderboard</h1>
          {season && (
            <div className={styles.seasonBlock}>
              <div className={styles.seasonTitle}>
                Season {season.seasonNumber} — {daysRemaining(season.endDate)} days remaining
              </div>
              <div className={styles.progressTrack}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${seasonProgress(season.startDate, season.endDate)}%` }}
                />
              </div>
              <div className={styles.seasonCaption}>Season progress</div>
            </div>
          )}
        </header>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'players'}
            className={`${styles.tab} ${tab === 'players' ? styles.tabActive : ''}`}
            onClick={() => setTab('players')}
          >
            Players
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'drones'}
            className={`${styles.tab} ${tab === 'drones' ? styles.tabActive : ''}`}
            onClick={() => setTab('drones')}
          >
            Drones
          </button>
        </div>

        {loading ? (
          <div className={styles.podiumSkeleton}>
            <Skeleton variant="card" height={240} />
            <Skeleton variant="card" height={280} />
            <Skeleton variant="card" height={240} />
          </div>
        ) : (
          <Podium items={top3} tab={tab} />
        )}

        <DataTable
          columns={columns}
          data={rankedRest}
          loading={loading}
          emptyMessage="No ranked competitors yet."
          className={styles.table}
        />

        <Card className={styles.rewards}>
          <h2 className={styles.rewardsHeading}>Season Rewards Preview</h2>
          <div className={styles.rewardsGrid}>
            <div className={styles.rewardItem}>
              <div className={styles.rewardIcon}>🎨</div>
              <div className={styles.rewardLabel}>Exclusive Skins</div>
            </div>
            <div className={styles.rewardItem}>
              <div className={styles.rewardIcon}>🪙</div>
              <div className={styles.rewardLabel}>Token Prizes</div>
            </div>
            <div className={styles.rewardItem}>
              <div className={styles.rewardIcon}>🏆</div>
              <div className={styles.rewardLabel}>Titles / Badges</div>
            </div>
          </div>
        </Card>

        {user && myRank?.rank != null && (
          <div className={styles.stickyRank}>Your Rank: #{myRank.rank}</div>
        )}
      </div>
    </NavShell>
  );
}

function Podium({ items, tab }) {
  if (!items.length) return null;
  const first = items[0];
  const second = items[1];
  const third = items[2];

  return (
    <div className={styles.podium}>
      {second && <PodiumCard rank={2} entry={second} tab={tab} />}
      {first && <PodiumCard rank={1} entry={first} tab={tab} />}
      {third && <PodiumCard rank={3} entry={third} tab={tab} />}
    </div>
  );
}

function PodiumCard({ rank, entry, tab }) {
  const rankClass =
    rank === 1 ? styles.gold : rank === 2 ? styles.silver : styles.bronze;
  const name = tab === 'players' ? entry.username : entry.name;
  const wins = tab === 'players' ? entry.totalWins : entry.wins;
  const totalRaces = entry.totalRaces;
  const winRate =
    totalRaces > 0 ? ((wins / totalRaces) * 100).toFixed(0) + '%' : '—';
  const seasonPts = tab === 'players' ? entry.seasonPoints : '—';
  return (
    <Card className={`${styles.podiumCard} ${rankClass} ${rank === 1 ? styles.podiumFirst : ''}`}>
      <div className={styles.podiumRank}>
        <Trophy size={rank === 1 ? 28 : 22} /> {rank}{getOrdinal(rank)}
      </div>
      <h3 className={styles.podiumName}>{name ?? '—'}</h3>
      <div className={styles.podiumStats}>
        <Row label="Win Rate" value={winRate} />
        <Row label="Total Wins" value={wins ?? 0} />
        <Row label="ELO" value={entry.eloRating} />
        {tab === 'players' && <Row label="Points This Season" value={seasonPts} />}
      </div>
    </Card>
  );
}

function Row({ label, value }) {
  return (
    <div className={styles.podiumRow}>
      <span className={styles.podiumLabel}>{label}</span>
      <span className={styles.podiumValue}>{value}</span>
    </div>
  );
}

function getOrdinal(n) {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}
