'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trophy, Sparkles, Coins, Award, ChevronRight } from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import DataTable from '@/components/ui/DataTable';
import Toggle from '@/components/ui/Toggle';
import Skeleton from '@/components/ui/Skeleton';
import { useSession } from '@/hooks/useSession';
import { useRaceRoundEnd } from '@/lib/race-round-clock';
import { cn, getLevelColor, getLegendaryTheme } from '@/lib/utils';
import DroneImage from '@/components/ui/DroneImage';
import PlayerAvatar from '@/components/ui/PlayerAvatar';
import VoltIcon from '@/components/ui/VoltIcon';
import styles from './page.module.css';

const PAGE_SIZE = 25;

const BRACKETS = [
  { value: 'all',   label: 'All Levels' },
  { value: '1-5',   label: 'LV 1-5' },
  { value: '6-10',  label: 'LV 6-10' },
  { value: '11-15', label: 'LV 11-15' },
  { value: '16-20', label: 'LV 16-20' },
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
  const router = useRouter();
  const { user } = useSession();
  const [tab, setTab] = useState('players');
  const [bracket, setBracket] = useState('all');
  const [includeBots, setIncludeBots] = useState(false);
  const [items, setItems] = useState([]);
  const [season, setSeason] = useState(null);
  const [myStats, setMyStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [myDroneIds, setMyDroneIds] = useState(new Set());
  const [page, setPage] = useState(1);
  // Reset to page 1 whenever the data set changes (tab / bracket / bots toggle).
  const [trackedDataKey, setTrackedDataKey] = useState(`${tab}|${bracket}|${includeBots}`);
  const dataKey = `${tab}|${bracket}|${includeBots}`;
  if (dataKey !== trackedDataKey) {
    setTrackedDataKey(dataKey);
    setPage(1);
  }

  /* `silent: true` skips the loading-skeleton flip - used by the
     race-round-end auto-refresh below so the table doesn't blink to
     skeleton on every cycle. Filter changes default to silent: false
     so the user sees the skeleton when they actively change views. */
  const fetchData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
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
      if (!silent) setLoading(false);
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

  /* Race-round-end auto-refresh. Driven by the global race-round-clock
     hook - fires only after a race actually completes server-side
     (status flips pending -> completed). Silent fetchData keeps the
     table from blinking to skeleton each cycle. fetchMyDrones not
     re-called - drone IDs only change on create/delete/sale. */
  const roundTick = useRaceRoundEnd();
  useEffect(() => {
    if (roundTick === 0) return;
    fetchData({ silent: true }).catch(() => {});
    fetchMyStats().catch(() => {});
  }, [roundTick, fetchData, fetchMyStats]);

  const top3 = items.slice(0, 3);
  const rest = useMemo(
    () => items.slice(3).map((row, i) => ({ ...row, __rank: i + 4 })),
    [items],
  );
  const totalPages = Math.max(1, Math.ceil(rest.length / PAGE_SIZE));
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRows = rest.slice(pageStart, pageStart + PAGE_SIZE);

  const handleRowClick = (row) => {
    if (!row?.id) return;
    if (tab === 'players') router.push(`/profile/${row.id}`);
    else router.push(`/drones/${row.id}`);
  };

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
        label: 'Volts Earned',
        shortLabel: 'V',
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
              {' '}| LV {r.level}
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
              <span
                className={styles.rewardInline}
                title="Exclusive Skins"
                aria-label="Exclusive Skins"
              >
                <span
                  className={cn(styles.rewardThumb, styles.rewardThumbSkins)}
                  aria-hidden="true"
                >
                  <Sparkles size={12} />
                </span>
                <span className={styles.rewardText}>Exclusive Skins</span>
              </span>
              <span
                className={styles.rewardInline}
                title="Volt Prizes"
                aria-label="Volt Prizes"
              >
                <span
                  className={cn(styles.rewardThumb, styles.rewardThumbPoints)}
                  aria-hidden="true"
                >
                  <Coins size={12} />
                </span>
                <span className={styles.rewardText}>Volt Prizes</span>
              </span>
              <span
                className={styles.rewardInline}
                title="Titles / Badges"
                aria-label="Titles / Badges"
              >
                <span
                  className={cn(styles.rewardThumb, styles.rewardThumbTitles)}
                  aria-hidden="true"
                >
                  <Award size={12} />
                </span>
                <span className={styles.rewardText}>Titles / Badges</span>
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
          data={pageRows}
          loading={loading}
          emptyMessage={
            tab === 'players'
              ? 'No players on the board yet.'
              : 'No drones match the current filters.'
          }
          rowClassName={(row) => (rowIsMine(row) ? styles.myRow : null)}
          onRowClick={handleRowClick}
          className={styles.rankingsTable}
        />

        {totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        )}
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
            <span className={styles.yourRankLabel}>Season</span>
            <span className={styles.yourRankValue}>
              <VoltIcon size={12} />
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
  /* On mobile the podium becomes a horizontal scroll carousel. The
   * 1st-place card sits in the middle of the DOM (between 2nd and 3rd)
   * so on initial render we scrollLeft into the middle card. Direct
   * scrollLeft assignment (instead of scrollTo) skips smooth-scroll
   * animation - the user shouldn't see the carousel scroll itself
   * into position on page load.
   *
   * Re-runs whenever `items` changes (e.g. a tab switch swaps the
   * top-3 list) so the new middle card stays centered. The desktop
   * grid isn't horizontally scrollable, so the scrollLeft assignment
   * is a no-op there. */
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const middleCard = el.children[1];
    if (!middleCard) return;
    const offset =
      middleCard.offsetLeft -
      (el.clientWidth - middleCard.clientWidth) / 2;
    el.scrollLeft = offset;
  }, [items]);

  return (
    <div className={styles.podium} ref={ref}>
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
              <>
                {' '}
                <span
                  className={styles.podiumLevel}
                  style={{ color: getLevelColor(droneLevel) }}
                >
                  LV {droneLevel}
                </span>
              </>
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
        {tab === 'players' ? (
          <PlayerAvatar ariaLabel={name ?? 'Unclaimed'} />
        ) : (
          <DroneImage drone={entry} alt={name ?? 'Unclaimed'} />
        )}
      </div>

      <dl className={styles.podiumStats}>
        <PodiumStat
          label="Win Rate"
          value={empty ? '-' : winRate != null ? `${winRate}%` : '-'}
        />
        <PodiumStat label="Wins" value={empty ? '-' : wins} />
        <PodiumStat label="ELO" value={empty ? '-' : entry.eloRating} />
        {tab === 'players' && (
          <PodiumStat
            label="Season"
            value={
              empty ? (
                '-'
              ) : (
                <>
                  <VoltIcon size={12} />
                  {seasonPts ?? 0}
                </>
              )
            }
          />
        )}
      </dl>
    </>
  );

  const isLegendaryEntry =
    !empty &&
    tab === 'drones' &&
    entry?.appliedSkin?.rarity === 'legendary';
  const legendaryTheme = isLegendaryEntry
    ? getLegendaryTheme(entry.appliedSkin?.name)
    : null;
  const legendaryStyle = legendaryTheme
    ? {
        '--legendary-bg': legendaryTheme.bg,
        '--legendary-glow-1': legendaryTheme.glow1,
      }
    : undefined;

  const classes = cn(
    styles.podiumCard,
    rankClass,
    rank === 1 && styles.podiumFirst,
    empty && styles.podiumEmpty,
    legendaryTheme && styles.skinRarity_legendary,
  );

  if (linkHref) {
    return (
      <Link
        href={linkHref}
        className={cn(classes, styles.podiumCardLink)}
        style={legendaryStyle}
      >
        {body}
      </Link>
    );
  }
  return (
    <div className={classes} style={legendaryStyle}>
      {body}
    </div>
  );
}

function PodiumStat({ label, value }) {
  return (
    <div className={styles.podiumStatRow}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pagination - same numbered pattern as the races page                        */
/* -------------------------------------------------------------------------- */

function Pagination({ page, totalPages, onPageChange }) {
  const pages = getVisiblePages(page, totalPages);
  return (
    <nav className={styles.pagination} aria-label="Pagination">
      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`ell-${i}`} className={styles.pageEllipsis}>…</span>
        ) : (
          <button
            key={p}
            type="button"
            className={cn(styles.pageNum, p === page && styles.pageNumActive)}
            onClick={() => onPageChange(p)}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        className={styles.pageNext}
        disabled={page >= totalPages}
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        aria-label="Next page"
      >
        <ChevronRight size={14} />
      </button>
    </nav>
  );
}

function getVisiblePages(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (current > 3) pages.push('...');
  const lo = Math.max(2, current - 1);
  const hi = Math.min(total - 1, current + 1);
  for (let i = lo; i <= hi; i++) pages.push(i);
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}
