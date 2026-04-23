'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Trophy, Sparkles, Coins, Award } from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import DataTable from '@/components/ui/DataTable';
import Toggle from '@/components/ui/Toggle';
import Skeleton from '@/components/ui/Skeleton';
import { useSession } from '@/hooks/useSession';
import { cn, getDroneImage, getLevelColor } from '@/lib/utils';
import styles from './page.module.css';

const BRACKETS = [
  { value: 'all',   label: 'All Levels' },
  { value: '1-5',   label: 'Lv 1-5' },
  { value: '6-10',  label: 'Lv 6-10' },
  { value: '11-15', label: 'Lv 11-15' },
  { value: '16-20', label: 'Lv 16-20' },
];

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

function computeWinRate(wins, races) {
  if (!races || races <= 0) return null;
  return Math.round((wins / races) * 100);
}

/* -------------------------------------------------------------------------- */

export default function LeaderboardPage() {
  const { user } = useSession();
  const [tab, setTab] = useState('players');
  const [bracket, setBracket] = useState('all');
  const [includeBots, setIncludeBots] = useState(false);
  const [items, setItems] = useState([]);
  const [season, setSeason] = useState(null);
  const [myStats, setMyStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [myDroneIds, setMyDroneIds] = useState(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type: tab,
        sort_by: 'elo',
        limit: '100',
      });
      if (tab === 'drones' && bracket !== 'all') params.set('bracket', bracket);
      if (tab === 'drones' && includeBots) params.set('include_bots', 'true');
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
  }, [tab, bracket, includeBots]);

  const fetchMyStats = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await fetch('/api/leaderboard/me');
      const body = await res.json();
      if (body?.data) setMyStats(body.data);
    } catch {
      /* noop */
    }
  }, [user?.id]);

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

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchMyStats(); }, [fetchMyStats]);
  useEffect(() => { fetchMyDrones(); }, [fetchMyDrones]);

  const top3 = items.slice(0, 3);
  const rest = useMemo(
    () => items.slice(3).map((row, i) => ({ ...row, __rank: i + 4 })),
    [items],
  );

  const rowIsMine = (row) => {
    if (tab === 'players') return user?.id && row.id === user.id;
    return myDroneIds.has(row.id);
  };

  const playerColumns = useMemo(
    () => [
      {
        key: '__rank',
        label: 'Rank',
        shortLabel: '#',
        align: 'left',
        render: (r) => <span className={styles.rankCell}>#{r.__rank}</span>,
      },
      {
        key: 'username',
        label: 'Player Name',
        shortLabel: 'Player',
        render: (r) => (
          <span className={styles.nameCell}>{r.username || '-'}</span>
        ),
      },
      {
        key: 'totalRaces',
        label: 'Races',
        sortable: true,
        align: 'right',
      },
      {
        key: 'totalWins',
        label: 'Wins',
        sortable: true,
        align: 'right',
      },
      {
        key: 'winRate',
        label: 'Win Rate',
        shortLabel: 'Rate',
        sortable: true,
        align: 'right',
        render: (r) => {
          const rate = computeWinRate(r.totalWins, r.totalRaces);
          return rate == null ? '-' : `${rate}%`;
        },
      },
      {
        key: 'eloRating',
        label: 'ELO',
        sortable: true,
        align: 'right',
        render: (r) => <span className={styles.mono}>{r.eloRating}</span>,
      },
      {
        key: 'seasonPoints',
        label: 'Points Earned',
        shortLabel: 'Pts',
        sortable: true,
        align: 'right',
        render: (r) => <span className={styles.mono}>{r.seasonPoints}</span>,
      },
    ],
    [],
  );

  const droneColumns = useMemo(
    () => [
      {
        key: '__rank',
        label: 'Rank',
        shortLabel: '#',
        align: 'left',
        render: (r) => <span className={styles.rankCell}>#{r.__rank}</span>,
      },
      {
        key: 'name',
        label: 'Drone',
        render: (r) => (
          <span className={styles.nameCell}>
            {r.name}
            <span
              className={styles.levelSuffix}
              style={{ color: getLevelColor(r.level) }}
            >
              {' '}| Lv {r.level}
            </span>
          </span>
        ),
      },
      {
        key: 'totalRaces',
        label: 'Races',
        sortable: true,
        align: 'right',
      },
      {
        key: 'wins',
        label: 'Wins',
        sortable: true,
        align: 'right',
      },
      {
        key: 'winRate',
        label: 'Win Rate',
        shortLabel: 'Rate',
        sortable: true,
        align: 'right',
        render: (r) => {
          const rate = computeWinRate(r.wins, r.totalRaces);
          return rate == null ? '-' : `${rate}%`;
        },
      },
      {
        key: 'eloRating',
        label: 'ELO',
        sortable: true,
        align: 'right',
        render: (r) => <span className={styles.mono}>{r.eloRating}</span>,
      },
    ],
    [],
  );

  const columns = tab === 'players' ? playerColumns : droneColumns;

  const progress = seasonProgress(season?.startDate, season?.endDate);
  const daysLeft = daysRemaining(season?.endDate);

  return (
    <NavShell>
      <div className={styles.page}>
        {/* ---- Season header: season info + tabs (right) + progress + rewards ---- */}
        {season && (
          <section className={styles.seasonBlock}>
            <div className={styles.seasonTopRow}>
              <div className={styles.seasonTopLine}>
                <span className={styles.seasonLabel}>
                  Season {season.seasonNumber ?? 1}
                </span>
                <span className={styles.seasonSep} aria-hidden="true">
                  ·
                </span>
                <span className={styles.seasonRemaining}>
                  <span className={styles.seasonRemainingValue}>
                    {daysLeft}
                  </span>{' '}
                  days remaining
                </span>
                <div className={styles.progressInline}>
                  <div className={styles.progressTrack}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className={styles.progressPct}>
                    {Math.round(progress)}%
                  </span>
                </div>
              </div>

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
            </div>

            <div className={styles.rewardsRow}>
              <span className={styles.rewardsLabel}>Season Rewards</span>
              <span className={styles.rewardInline}>
                <span
                  className={cn(styles.rewardThumb, styles.rewardThumbSkins)}
                  aria-hidden="true"
                >
                  <Sparkles size={12} />
                </span>
                Exclusive Skins
              </span>
              <span className={styles.rewardInline}>
                <span
                  className={cn(styles.rewardThumb, styles.rewardThumbPoints)}
                  aria-hidden="true"
                >
                  <Coins size={12} />
                </span>
                Point Prizes
              </span>
              <span className={styles.rewardInline}>
                <span
                  className={cn(styles.rewardThumb, styles.rewardThumbTitles)}
                  aria-hidden="true"
                >
                  <Award size={12} />
                </span>
                Titles / Badges
              </span>
            </div>
          </section>
        )}

        {/* ---- Drone-only filter row: bracket text tabs + humans toggle ---- */}
        {tab === 'drones' && (
          <div className={styles.filterRow}>
            <div className={styles.bracketTabs} role="tablist">
              {BRACKETS.map((b) => (
                <button
                  key={b.value}
                  type="button"
                  role="tab"
                  aria-selected={bracket === b.value}
                  className={cn(
                    styles.bracketTab,
                    bracket === b.value && styles.bracketTabActive,
                  )}
                  onClick={() => setBracket(b.value)}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className={styles.botsToggle}>
              <span className={styles.botsToggleLabel}>Include bots</span>
              <Toggle checked={includeBots} onChange={setIncludeBots} />
            </div>
          </div>
        )}

        {/* ---- Podium ---- */}
        {loading ? (
          <div className={styles.podium}>
            <Skeleton variant="card" height={280} />
            <Skeleton variant="card" height={320} />
            <Skeleton variant="card" height={280} />
          </div>
        ) : (
          <Podium items={top3} tab={tab} />
        )}

        {/* ---- Rankings - just the table, no container ---- */}
        <DataTable
          sortable
          columns={columns}
          data={rest}
          loading={loading}
          emptyMessage={
            tab === 'players'
              ? 'No players on the board yet.'
              : 'No drones match the current filters.'
          }
          rowClassName={(row) => (rowIsMine(row) ? styles.myRow : null)}
          className={styles.rankingsTable}
        />
      </div>

      {/* ---- Sticky "Your Rank" bar (logged-in users only) ---- */}
      {user && myStats && (
        <div className={styles.yourRankBar}>
          <span className={styles.yourRankSegment}>
            <span className={styles.yourRankLabel}>Your Rank</span>
            <span className={styles.yourRankValue}>
              #{myStats.rank ?? '-'}
            </span>
          </span>
          <span className={styles.yourRankDivider} aria-hidden="true" />
          <span className={styles.yourRankSegment}>
            <span className={styles.yourRankLabel}>ELO</span>
            <span className={styles.yourRankValue}>
              {myStats.eloRating ?? 0}
            </span>
          </span>
          <span className={styles.yourRankDivider} aria-hidden="true" />
          <span className={styles.yourRankSegment}>
            <span className={styles.yourRankLabel}>Season Pts</span>
            <span className={styles.yourRankValue}>
              {myStats.seasonPoints ?? 0}
            </span>
          </span>
        </div>
      )}
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
  const winRate = computeWinRate(wins, totalRaces);
  const seasonPts = tab === 'players' ? entry?.seasonPoints : null;
  const imageUrl = getDroneImage(entry);

  const rankClass =
    rank === 1 ? styles.gold : rank === 2 ? styles.silver : styles.bronze;
  const rankLabel = rank === 1 ? '1ST' : rank === 2 ? '2ND' : '3RD';

  const linkHref =
    !empty && tab === 'players' && entry?.id
      ? `/profile/${entry.id}`
      : !empty && tab === 'drones' && entry?.id
      ? `/drones/${entry.id}`
      : null;

  const trophySize = rank === 1 ? 22 : 18;
  const droneLevel = !empty && tab === 'drones' ? entry.level : null;

  const body = (
    <>
      <div className={styles.podiumHeader}>
        <div className={styles.podiumHeaderLeft}>
          <div className={styles.podiumName}>
            {empty ? 'Unclaimed' : name}
            {droneLevel != null && (
              <span
                className={styles.podiumLevel}
                style={{ color: getLevelColor(droneLevel) }}
              >
                {' '}
                · Lv {droneLevel}
              </span>
            )}
          </div>
          <div className={styles.podiumRankLabel}>{rankLabel}</div>
        </div>
        <Trophy
          size={trophySize}
          className={styles.podiumTrophy}
          strokeWidth={2.2}
          aria-hidden="true"
        />
      </div>

      <div className={styles.podiumImageFrame}>
        <img src={imageUrl} alt={name ?? 'Unclaimed'} />
      </div>

      <dl className={styles.podiumStats}>
        <PodiumStat
          label="Win Rate"
          value={empty ? '-' : winRate != null ? `${winRate}%` : '-'}
        />
        <PodiumStat label="Wins" value={empty ? '-' : wins} />
        <PodiumStat label="ELO" value={empty ? '-' : entry.eloRating} />
        {tab === 'players' && (
          <PodiumStat label="Season Pts" value={empty ? '-' : seasonPts ?? 0} />
        )}
      </dl>
    </>
  );

  const classes = cn(
    styles.podiumCard,
    rankClass,
    rank === 1 && styles.podiumFirst,
    empty && styles.podiumEmpty,
  );

  if (linkHref) {
    return (
      <Link href={linkHref} className={cn(classes, styles.podiumCardLink)}>
        {body}
      </Link>
    );
  }
  return <div className={classes}>{body}</div>;
}

function PodiumStat({ label, value }) {
  return (
    <div className={styles.podiumStatRow}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
