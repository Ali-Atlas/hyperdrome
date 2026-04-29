'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Trophy } from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import VoltIcon from '@/components/ui/VoltIcon';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/hooks/useSession';
import {
  cn,
  getLevelColor,
  getLevelTier,
  getLegendaryTheme,
} from '@/lib/utils';
import DroneImage from '@/components/ui/DroneImage';
import styles from './page.module.css';

/** NPC vendor price + free-drone milestones. Mirror values in
 *  app/api/drones/create/route.js (DRONE_PRICE=3500). The milestones are
 *  display-only here; whatever system grants the free drones lives
 *  elsewhere and the toast effect just reacts to the drone count + race
 *  total crossing a threshold between page loads. */
const DRONE_PRICE = 3500;
const MILESTONE_FIRST = 3000;
const MILESTONE_SECOND = 10000;
const FREE_DRONE_CAP = 3;

const TIERS = ['steel', 'orange', 'purple', 'gold'];
const TIER_LABELS = {
  steel: 'LV 1-5',
  orange: 'LV 6-10',
  purple: 'LV 11-15',
  gold: 'LV 16-20',
};

const SORTS = {
  recent: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  level: (a, b) => b.level - a.level || b.eloRating - a.eloRating,
  elo: (a, b) => b.eloRating - a.eloRating,
  winrate: (a, b) => winRate(b) - winRate(a),
};
const SORT_LABELS = {
  recent: 'Most Recent',
  level: 'Level · High to Low',
  elo: 'ELO · High to Low',
  winrate: 'Win Rate',
};

function winRate(d) {
  return d.totalRaces > 0 ? d.wins / d.totalRaces : 0;
}

export default function DronesPage() {
  const session = useSession();
  const { showToast } = useToast();
  const [drones, setDrones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all' | 'active' | 'inactive'
  const [sort, setSort] = useState('level');
  const [vendorOpen, setVendorOpen] = useState(false);
  const [vendorPending, setVendorPending] = useState(false);
  const [vendorError, setVendorError] = useState(null);

  async function refreshDrones() {
    const res = await fetch('/api/drones');
    const body = await res.json();
    if (res.ok && body?.data) setDrones(body.data);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/drones');
        const body = await res.json();
        if (!cancelled && res.ok && body?.data) {
          setDrones(body.data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Milestone toast: when a free drone shows up between page loads (drone
  // count went up while totalRaces crossed a threshold), surface it. State
  // is per-user in localStorage so the same browser doesn't re-fire on
  // every reload, and a different user on the same browser has its own
  // baseline.
  useEffect(() => {
    if (loading || drones.length === 0) return;
    const userId = session.user?.id;
    if (!userId) return;
    const totalRaces = drones.reduce((s, d) => s + (d.totalRaces ?? 0), 0);
    const droneCount = drones.length;
    const key = `hyperdrome:drones:milestone:${userId}`;
    let prev = null;
    try {
      prev = JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      prev = null;
    }
    if (prev) {
      const crossedFirst =
        prev.totalRaces < MILESTONE_FIRST && totalRaces >= MILESTONE_FIRST;
      const crossedSecond =
        prev.totalRaces < MILESTONE_SECOND && totalRaces >= MILESTONE_SECOND;
      const droneAdded = droneCount > prev.droneCount;
      if ((crossedFirst || crossedSecond) && droneAdded) {
        showToast(
          'Milestone reached! New drone added to your fleet.',
          'success',
        );
      }
    }
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ totalRaces, droneCount }),
      );
    } catch {
      /* localStorage may be disabled - skip silently */
    }
  }, [loading, drones, session.user?.id, showToast]);

  async function handlePurchase() {
    setVendorPending(true);
    setVendorError(null);
    try {
      const res = await fetch('/api/drones/create', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        setVendorError(body?.error?.message || 'Purchase failed.');
        setVendorPending(false);
        return;
      }
      await refreshDrones();
      showToast('Drone added to your fleet.', 'success');
      setVendorOpen(false);
    } catch (err) {
      console.error(err);
      setVendorError('Purchase failed. Try again.');
    } finally {
      setVendorPending(false);
    }
  }

  function closeVendor() {
    if (vendorPending) return;
    setVendorOpen(false);
    setVendorError(null);
  }

  const fleet = useMemo(() => computeFleetStats(drones), [drones]);

  const visibleDrones = useMemo(() => {
    let list = drones;
    if (filter === 'active') list = list.filter((d) => d.active);
    else if (filter === 'inactive') list = list.filter((d) => !d.active);
    return [...list].sort(SORTS[sort]);
  }, [drones, filter, sort]);

  return (
    <NavShell>
      <div className={styles.page}>
        {loading ? (
          <>
            <Skeleton variant="card" height={70} />
            <div className={styles.grid}>
              <Skeleton variant="card" height={380} />
              <Skeleton variant="card" height={380} />
              <Skeleton variant="card" height={380} />
              <Skeleton variant="card" height={380} />
            </div>
          </>
        ) : drones.length === 0 ? (
          <EmptyState
            title="No drones yet"
            description="Your starter drone is created on first sign-in. Log out and in again if this is unexpected."
          />
        ) : (
          <>
            <div className={styles.fleetRow}>
              {fleet.top && <TopPerformerCard top={fleet.top} />}
              <FleetOverview fleet={fleet} />
            </div>
            <ControlBar
              filter={filter}
              onFilter={setFilter}
              sort={sort}
              onSort={setSort}
              active={fleet.active}
              total={fleet.total}
            />
            {visibleDrones.length === 0 ? (
              <EmptyState
                title="No drones match this filter"
                description="Switch the toggle above to see the rest of your fleet."
              />
            ) : (
              <div className={styles.grid}>
                {visibleDrones.map((drone) => (
                  <DroneCard key={drone.id} drone={drone} />
                ))}
                <VendorCard onClick={() => setVendorOpen(true)} />
              </div>
            )}
          </>
        )}

        <VendorModal
          isOpen={vendorOpen}
          onClose={closeVendor}
          onPurchase={handlePurchase}
          pending={vendorPending}
          error={vendorError}
          userPoints={session.user?.points ?? 0}
          totalRaces={drones.reduce(
            (s, d) => s + (d.totalRaces ?? 0),
            0,
          )}
          droneCount={drones.length}
        />
      </div>
    </NavShell>
  );
}

/* -------------------------------------------------------------------------- */
/* NPC vendor card + modal                                                     */
/* -------------------------------------------------------------------------- */

function VendorCard({ onClick }) {
  return (
    <button
      type="button"
      className={styles.vendorCard}
      onClick={onClick}
      aria-label="Recruit new drone"
    >
      <Plus
        size={48}
        strokeWidth={1.5}
        className={styles.vendorIcon}
        aria-hidden="true"
      />
      <span className={styles.vendorTitle}>New Drone</span>
      <span className={styles.vendorPrice}>
        <VoltIcon size={14} />
        {DRONE_PRICE.toLocaleString()}
      </span>
    </button>
  );
}

function MilestoneRow({ label, current, target }) {
  const progress = Math.min(100, (current / target) * 100);
  return (
    <div className={styles.milestone}>
      <div className={styles.milestoneLabel}>{label}</div>
      <div className={styles.milestoneCount}>
        {current.toLocaleString()} / {target.toLocaleString()} races
      </div>
      <div className={styles.milestoneTrack} aria-hidden="true">
        <div
          className={styles.milestoneFill}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function VendorModal({
  isOpen,
  onClose,
  onPurchase,
  pending,
  error,
  userPoints,
  totalRaces,
  droneCount,
}) {
  const canAfford = userPoints >= DRONE_PRICE;
  // Captain spec: show second milestone only when fleet is small AND the
  // first milestone was already crossed.
  const showSecond =
    droneCount < FREE_DRONE_CAP && totalRaces >= MILESTONE_FIRST;
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Recruit New Drone" size="md">
      <div className={styles.vendorModalBody}>
        <img
          src="/drones/tier-1.webp"
          alt="Tier 1 starter drone"
          className={styles.vendorModalImage}
        />
        <p className={styles.vendorModalDesc}>
          LV 1 starter drone with randomized stats. Includes 1 random
          common skin and 1 random common mod.
        </p>
        <div className={styles.vendorModalPriceRow}>
          <VoltIcon size={20} />
          <span className={styles.vendorModalPrice}>
            {DRONE_PRICE.toLocaleString()}
          </span>
        </div>

        <div className={styles.milestoneList}>
          <MilestoneRow
            label="Free drone at 3,000 races"
            current={totalRaces}
            target={MILESTONE_FIRST}
          />
          {showSecond && (
            <MilestoneRow
              label="Free drone at 10,000 races"
              current={totalRaces}
              target={MILESTONE_SECOND}
            />
          )}
          <p className={styles.milestoneCap}>XP drones cap at 3</p>
        </div>

        {error && <p className={styles.vendorError}>{error}</p>}

        <div className={styles.vendorActions}>
          <Button
            variant="ghost"
            size="md"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <span
            title={!canAfford ? 'Not enough Volts' : undefined}
            className={styles.vendorPurchaseWrap}
          >
            <Button
              variant="primary"
              size="md"
              onClick={onPurchase}
              loading={pending}
              disabled={!canAfford || pending}
            >
              Purchase
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Fleet overview strip                                                        */
/* -------------------------------------------------------------------------- */

function computeFleetStats(drones) {
  if (drones.length === 0) {
    return {
      total: 0,
      active: 0,
      avgLevel: 0,
      avgElo: 0,
      totalRaces: 0,
      totalWins: 0,
      fleetWinRate: 0,
      top: null,
      tierCounts: { steel: 0, orange: 0, purple: 0, gold: 0 },
    };
  }
  let lvl = 0;
  let elo = 0;
  let races = 0;
  let wins = 0;
  let active = 0;
  let top = drones[0];
  const tierCounts = { steel: 0, orange: 0, purple: 0, gold: 0 };
  for (const d of drones) {
    lvl += d.level;
    elo += d.eloRating;
    races += d.totalRaces;
    wins += d.wins;
    if (d.active) active += 1;
    if (d.eloRating > top.eloRating) top = d;
    tierCounts[getLevelTier(d.level)] += 1;
  }
  return {
    total: drones.length,
    active,
    avgLevel: Math.round(lvl / drones.length),
    avgElo: Math.round(elo / drones.length),
    totalRaces: races,
    totalWins: wins,
    fleetWinRate: races > 0 ? wins / races : 0,
    top,
    tierCounts,
  };
}

function FleetOverview({ fleet }) {
  // Active cap is 3 (enforced server-side). Tint the chip when maxed.
  const atCap = fleet.active >= 3;
  return (
    <section className={styles.fleet}>
      <div className={styles.fleetLabel}>Fleet</div>
      <div className={styles.fleetContent}>
        <div className={styles.fleetStats}>
          <FleetStat label="Drones" value={fleet.total} />
          <FleetStat
            label="Active"
            value={`${fleet.active}/3`}
            tone={atCap ? 'warn' : fleet.active > 0 ? 'accent' : undefined}
          />
          <FleetStat label="Avg Level" value={fleet.avgLevel} />
          <FleetStat label="Avg ELO" value={fleet.avgElo.toLocaleString()} />
          <FleetStat label="Races" value={fleet.totalRaces.toLocaleString()} />
          <FleetStat
            label="Win Rate"
            value={`${(fleet.fleetWinRate * 100).toFixed(1)}%`}
          />
        </div>
        <TierDistribution counts={fleet.tierCounts} total={fleet.total} />
      </div>
    </section>
  );
}

/* Top performer sits as its own accent-tinted entity to the left of the
   fleet container - the best drone in the garage earns a visual pedestal. */
function TopPerformerCard({ top }) {
  return (
    <Link href={`/drones/${top.id}`} className={styles.topPerformer}>
      <span className={styles.topPerfHeader}>
        <Trophy size={11} aria-hidden="true" />
        Top Performer
      </span>
      <span className={styles.topPerfName}>{top.name}</span>
      <span className={styles.topPerfMeta}>
        <span
          className={styles.topPerfLevel}
          style={{ color: getLevelColor(top.level) }}
        >
          L{top.level}
        </span>
        <span className={styles.topPerfElo}>ELO {top.eloRating}</span>
      </span>
    </Link>
  );
}

function FleetStat({ label, value, tone }) {
  return (
    <div className={styles.fleetStat}>
      <div className={styles.fleetStatLabel}>{label}</div>
      <div
        className={cn(
          styles.fleetStatValue,
          tone === 'accent' && styles.fleetStatAccent,
          tone === 'warn' && styles.fleetStatWarn,
        )}
      >
        {value}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tier distribution bar                                                       */
/* -------------------------------------------------------------------------- */

function TierDistribution({ counts, total }) {
  if (total === 0) return null;
  const entries = TIERS.filter((t) => counts[t] > 0);
  return (
    <section className={styles.tierDist}>
      <div className={styles.tierTrack}>
        {entries.map((t) => (
          <div
            key={t}
            className={cn(styles.tierSeg, styles[`tierSeg_${t}`])}
            style={{ flexGrow: counts[t] }}
            title={`${TIER_LABELS[t]}: ${counts[t]} drones`}
          />
        ))}
      </div>
      <div className={styles.tierLegend}>
        {TIERS.map((t) => (
          <span key={t} className={styles.tierLegendItem}>
            <span
              className={cn(styles.tierSwatch, styles[`tierSwatch_${t}`])}
              aria-hidden="true"
            />
            <span className={styles.tierLegendLabel}>{TIER_LABELS[t]}</span>
            <span className={styles.tierLegendValue}>{counts[t] ?? 0}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Control bar - filter toggle + sort dropdown                                 */
/* -------------------------------------------------------------------------- */

function ControlBar({
  filter,
  onFilter,
  sort,
  onSort,
  active,
  total,
}) {
  return (
    <div className={styles.controls}>
      <div className={styles.segGroup} role="tablist">
        {[
          { id: 'all', label: `All (${total})` },
          { id: 'active', label: `Active (${active})` },
          { id: 'inactive', label: `Inactive (${total - active})` },
        ].map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={filter === opt.id}
            className={cn(
              styles.segBtn,
              filter === opt.id && styles.segBtnActive,
            )}
            onClick={() => onFilter(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className={styles.sortWrap}>
        <label className={styles.sortLabel} htmlFor="dronesSort">
          Sort
        </label>
        <select
          id="dronesSort"
          className={styles.sortSelect}
          value={sort}
          onChange={(e) => onSort(e.target.value)}
        >
          {Object.entries(SORT_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Drone card - richer version matching the drone manager style.               */
/* -------------------------------------------------------------------------- */

function DroneCard({ drone }) {
  const wr = winRate(drone);
  const wrLabel = drone.totalRaces > 0 ? `${(wr * 100).toFixed(0)}%` : '-';
  const tier = getLevelTier(drone.level);
  const skin = drone.appliedSkin;
  const legendaryTheme =
    skin?.rarity === 'legendary' ? getLegendaryTheme(skin.name) : null;
  const legendaryStyle = legendaryTheme
    ? {
        '--legendary-bg': legendaryTheme.bg,
        '--legendary-glow-1': legendaryTheme.glow1,
        '--legendary-glow-2': legendaryTheme.glow2,
      }
    : undefined;

  return (
    <Link
      key={drone.id}
      href={`/drones/${drone.id}`}
      className={styles.cardLink}
    >
      <article
        className={cn(
          styles.droneCard,
          styles[`level_${tier}`],
          legendaryTheme && styles.skinRarity_legendary,
          drone.active && styles.active,
        )}
        style={legendaryStyle}
      >
        {drone.active && <span className={styles.activeRibbon}>Active</span>}

        <header className={styles.cardHead}>
          <h3 className={styles.droneName}>{drone.name}</h3>
          <span
            className={styles.levelChip}
            style={{ color: getLevelColor(drone.level) }}
          >
            LV {drone.level}
          </span>
        </header>

        <div className={styles.imageFrame}>
          <DroneImage
            drone={drone}
            alt={drone.name}
            className={styles.droneImg}
          />
        </div>

        <div className={styles.cardBody}>
          <div className={styles.kpiRow}>
            <Kpi label="ELO" value={drone.eloRating.toLocaleString()} />
            <Kpi
              label="W / L"
              value={`${drone.wins} / ${drone.losses}`}
            />
            <Kpi
              label="Win Rate"
              value={wrLabel}
              tone={wr >= 0.5 ? 'good' : drone.totalRaces > 0 ? 'bad' : undefined}
            />
          </div>

          {skin ? (
            <div
              className={cn(
                styles.skinChip,
                styles[`skinRarityColor_${skin.rarity}`],
              )}
            >
              <span className={styles.skinDiamond} aria-hidden="true">
                ◆
              </span>
              <span className={styles.skinName}>{skin.name}</span>
              <span className={styles.skinRarityLabel}>{skin.rarity}</span>
            </div>
          ) : (
            <div className={styles.skinChipEmpty}>No skin equipped</div>
          )}
        </div>
      </article>
    </Link>
  );
}

function Kpi({ label, value, tone }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>{label}</div>
      <div
        className={cn(
          styles.kpiValue,
          tone === 'good' && styles.kpiValueGood,
          tone === 'bad' && styles.kpiValueBad,
        )}
      >
        {value}
      </div>
    </div>
  );
}
