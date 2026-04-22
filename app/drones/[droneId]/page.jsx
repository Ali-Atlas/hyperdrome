'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronDown,
  Info,
  Sun,
  Moon,
  Cloud,
  CloudRain,
  CloudDrizzle,
  Wind,
  Timer,
  RotateCcw,
  Zap,
  Flag,
  ShoppingCart,
} from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import StatBar from '@/components/ui/StatBar';
import StatEditorRow from '@/components/ui/StatEditorRow';
import Toggle from '@/components/ui/Toggle';
import Button from '@/components/ui/Button';
import DataTable from '@/components/ui/DataTable';
import Skeleton from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/hooks/useSession';
import { getLevelColor } from '@/lib/utils';
import {
  STAT_KEYS,
  calculateStatUpgradeCost,
  calculateTotalUpgradeCost,
  calculatePerStatCap,
  calculateTSB,
  analyzeDronePerformance,
} from '@/lib/game-engine/economy.js';
import styles from './page.module.css';

const STAT_LABELS = {
  speed: 'Speed',
  turning: 'Turning',
  acceleration: 'Acceleration',
  durability: 'Durability',
  nightVision: 'Night Vision',
  batteryCapacity: 'Battery Capacity',
  rainHandling: 'Rain Handling',
  windResistance: 'Wind Resistance',
  consistency: 'Consistency',
};

const SNAKE_KEYS = {
  speed: 'speed',
  turning: 'turning',
  acceleration: 'acceleration',
  durability: 'durability',
  nightVision: 'night_vision',
  batteryCapacity: 'battery_capacity',
  rainHandling: 'rain_handling',
  windResistance: 'wind_resistance',
  consistency: 'consistency',
};

const CONDITION_ICONS = {
  'Clear Day': Sun,
  'Night Racing': Moon,
  Rain: CloudDrizzle,
  'Heavy Wind': Wind,
  'Long Tracks': Timer,
  'Technical Turns': RotateCcw,
  'Straight Lines': Zap,
  'Close Finishes': Flag,
};

function pickStats(drone) {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, drone[k] ?? 1]));
}

/* ==========================================================================
 * Top-level page — loads drone + listing, routes to management or public view
 * ========================================================================== */

export default function DroneDetailPage({ params }) {
  const { droneId } = use(params);
  const { user, status } = useSession();
  const [drone, setDrone] = useState(null);
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/drones/${droneId}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || 'Failed to load drone');
      } else {
        setDrone(body.data);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [droneId]);

  const loadListing = useCallback(async () => {
    try {
      const res = await fetch('/api/marketplace?item_type=drone&limit=100');
      const body = await res.json();
      if (body?.data?.items) {
        const found = body.data.items.find(
          (l) => l.droneId === droneId && l.status === 'active',
        );
        setListing(found ?? null);
      }
    } catch {
      /* silently ignore listing fetch failures */
    }
  }, [droneId]);

  useEffect(() => {
    load();
    loadListing();
  }, [load, loadListing]);

  if (loading || status === 'loading') {
    return (
      <NavShell>
        <div className={styles.page}>
          <Skeleton variant="text" width="40%" />
          <div className={styles.main}>
            <Skeleton variant="card" height={520} />
            <Skeleton variant="card" height={520} />
          </div>
        </div>
      </NavShell>
    );
  }

  if (error || !drone) {
    return (
      <NavShell>
        <div className={styles.page}>
          <p className={styles.error}>{error || 'Drone not found'}</p>
        </div>
      </NavShell>
    );
  }

  const isOwner = Boolean(user?.id && drone.userId === user.id);

  if (isOwner) {
    return <DroneManagementView drone={drone} onReload={load} />;
  }
  return <PublicDroneProfile drone={drone} listing={listing} />;
}

/* ==========================================================================
 * Management view — owner-only. Stat editor, race profile, history.
 * ========================================================================== */

function DroneManagementView({ drone, onReload }) {
  const { showToast } = useToast();
  const [editedStats, setEditedStats] = useState(() => pickStats(drone));
  const [saving, setSaving] = useState(false);
  const [togglePending, setTogglePending] = useState(false);

  useEffect(() => {
    setEditedStats(pickStats(drone));
  }, [drone]);

  const baseStats = useMemo(() => pickStats(drone), [drone]);
  const level = drone.level ?? 1;
  const cap = useMemo(() => calculatePerStatCap(level), [level]);
  const tsb = useMemo(() => calculateTSB(level), [level]);

  const totalCost = useMemo(
    () =>
      STAT_KEYS.reduce(
        (sum, key) =>
          sum + calculateTotalUpgradeCost(baseStats[key], editedStats[key]),
        0,
      ),
    [baseStats, editedStats],
  );

  const currentSum = useMemo(
    () => STAT_KEYS.reduce((s, k) => s + (editedStats[k] ?? 0), 0),
    [editedStats],
  );

  const availablePoints = (drone.unspentPoints ?? 0) - totalCost;
  const hasChanges = totalCost > 0;

  const increment = (key) => {
    setEditedStats((prev) => {
      const current = prev[key];
      if (current >= cap) return prev;
      if (currentSum + 1 > tsb) return prev;
      const nextCost = calculateStatUpgradeCost(current);
      if (availablePoints < nextCost) return prev;
      return { ...prev, [key]: current + 1 };
    });
  };

  const decrement = (key) => {
    setEditedStats((prev) => {
      if (prev[key] <= baseStats[key]) return prev;
      return { ...prev, [key]: prev[key] - 1 };
    });
  };

  const reset = () => setEditedStats(baseStats);

  const save = async () => {
    setSaving(true);
    try {
      const changes = {};
      for (const key of STAT_KEYS) {
        if (editedStats[key] !== baseStats[key]) {
          changes[SNAKE_KEYS[key]] = editedStats[key];
        }
      }
      const res = await fetch(`/api/drones/${drone.id}/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stat_changes: changes }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body?.error || 'Save failed', 'error');
      } else {
        showToast('Stats saved', 'success');
        await onReload();
      }
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (next) => {
    setTogglePending(true);
    try {
      const res = await fetch(`/api/drones/${drone.id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: next }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body?.error || 'Toggle failed', 'error');
      } else {
        showToast(next ? 'Drone activated' : 'Drone deactivated', 'success');
        await onReload();
      }
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setTogglePending(false);
    }
  };

  const performance = useMemo(
    () => analyzeDronePerformance(editedStats),
    [editedStats],
  );

  const winRate =
    drone.totalRaces > 0
      ? ((drone.wins / drone.totalRaces) * 100).toFixed(1) + '%'
      : '—';

  const raceRows = (drone.recentRaces ?? []).map((r) => {
    const isDrone1 = r.drone1Id === drone.id;
    const won = r.winnerDroneId === drone.id;
    return {
      id: r.id,
      opponent: isDrone1 ? r.drone2Id : r.drone1Id,
      trackName: r.track?.name ?? '—',
      conditions: `${r.weather} / ${r.timeOfDay}`,
      result: won ? 'WIN' : 'LOSS',
      pointsEarned: won ? r.pointsAwarded : 0,
    };
  });

  return (
    <NavShell>
      <div className={styles.page}>
        <div className={styles.main}>
          <Card className={styles.leftPanel}>
            <h2 className={styles.sectionHeading}>Drone</h2>
            <div className={styles.leftInner}>
              <div className={styles.droneNameBlock}>
                <div className={styles.droneName}>{drone.name}</div>
                <div className={styles.droneLevel}>
                  <span
                    className={styles.metaLevel}
                    style={{ color: getLevelColor(drone.level) }}
                  >
                    Lv {drone.level}
                  </span>
                  <span className={styles.metaSep}>|</span>
                  <span className={styles.metaOwner}>
                    Owner: {drone.owner?.username ?? '—'}
                  </span>
                </div>
              </div>

              <div className={styles.droneImageFrame}>
                <DroneImage drone={drone} />
              </div>

              <div className={styles.statStrip}>
                <div className={styles.statStripItem}>
                  <span className={styles.statStripLabel}>Total Races</span>
                  <span className={styles.statStripValue}>
                    {drone.totalRaces}
                  </span>
                </div>
                <div className={styles.statStripItem}>
                  <span className={styles.statStripLabel}>Wins</span>
                  <span className={styles.statStripValue}>{drone.wins}</span>
                </div>
                <div className={styles.statStripItem}>
                  <span className={styles.statStripLabel}>Losses</span>
                  <span className={styles.statStripValue}>
                    {drone.losses}
                  </span>
                </div>
                <div className={styles.statStripItem}>
                  <span className={styles.statStripLabel}>Win Rate</span>
                  <span className={styles.statStripValue}>{winRate}</span>
                </div>
                <div className={styles.statStripItem}>
                  <span className={styles.statStripLabel}>ELO</span>
                  <span className={styles.statStripValue}>
                    {drone.eloRating}
                  </span>
                </div>
                <div className={styles.statStripItem}>
                  <span className={styles.statStripLabel}>Unspent Points</span>
                  <span className={styles.statStripValue}>
                    {drone.unspentPoints ?? 0}
                  </span>
                </div>
              </div>

              <div className={styles.skinBlock}>
                <span className={styles.skinLabel}>Skin Equipped</span>
                <button type="button" className={styles.skinSelect}>
                  <span className={styles.skinSwatch} aria-hidden="true" />
                  <span className={styles.skinName}>
                    {drone.appliedSkin?.name ?? 'None'}
                  </span>
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </Card>

          <div className={styles.rightStack}>
            <Card className={styles.rightPanel}>
              <div className={styles.statHeader}>
                <h2 className={styles.sectionHeading}>Stat Editor</h2>
                <div className={styles.availablePoints}>
                  Available Points:{' '}
                  <span className={styles.availableValue}>
                    {availablePoints}
                  </span>
                </div>
              </div>

              <div className={styles.statList}>
                {STAT_KEYS.map((key) => (
                  <StatEditorRow
                    key={key}
                    statName={STAT_LABELS[key]}
                    currentValue={editedStats[key]}
                    baseValue={baseStats[key]}
                    maxValue={cap}
                    pointsAvailable={availablePoints}
                    costToUpgrade={calculateStatUpgradeCost(editedStats[key])}
                    onIncrement={() => increment(key)}
                    onDecrement={() => decrement(key)}
                  />
                ))}
              </div>

              <div className={styles.actions}>
                <div className={styles.activeBlock}>
                  <span className={styles.activeLabel}>Set Active</span>
                  <Toggle
                    checked={drone.active}
                    onChange={toggleActive}
                    disabled={togglePending}
                  />
                  <span
                    className={styles.activeHelp}
                    title="Active means this drone races each cycle. Up to 3 drones can be active per player."
                    aria-label="Set Active — active drones race each cycle. Up to 3 drones can be active per player."
                  >
                    <Info size={12} aria-hidden="true" />
                  </span>
                </div>
                <div className={styles.buttonGroup}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={save}
                    disabled={!hasChanges}
                    loading={saving}
                  >
                    Save
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={reset}
                    disabled={!hasChanges || saving}
                  >
                    Reset
                  </Button>
                </div>
              </div>
            </Card>

            <Card className={styles.perfSummaryCard}>
              <h2 className={styles.sectionHeading}>Performance Summary</h2>
              <div className={styles.raceProfileGrid}>
                <RaceProfileColumn
                  label="Optimal"
                  items={performance.optimal}
                  tone="optimal"
                />
                <RaceProfileColumn
                  label="Moderate"
                  items={performance.moderate}
                  tone="moderate"
                />
                <RaceProfileColumn
                  label="Poor"
                  items={performance.poor}
                  tone="poor"
                />
              </div>
            </Card>
          </div>
        </div>

        <Card className={styles.historyCard}>
          <h2 className={styles.sectionHeading}>Race History (Last 10 races)</h2>
          <RaceHistoryTable rows={raceRows} />
        </Card>
      </div>
    </NavShell>
  );
}

/* ==========================================================================
 * Public profile view — non-owner + unauthenticated.
 * Read-only, no editor. Shows marketplace CTA if the drone is listed.
 * ========================================================================== */

function PublicDroneProfile({ drone, listing }) {
  const stats = pickStats(drone);
  const winRate =
    drone.totalRaces > 0
      ? ((drone.wins / drone.totalRaces) * 100).toFixed(1) + '%'
      : '—';

  const raceRows = (drone.recentRaces ?? []).map((r) => {
    const isDrone1 = r.drone1Id === drone.id;
    const won = r.winnerDroneId === drone.id;
    return {
      id: r.id,
      opponent: isDrone1 ? r.drone2Id : r.drone1Id,
      trackName: r.track?.name ?? '—',
      conditions: `${r.weather} / ${r.timeOfDay}`,
      result: won ? 'WIN' : 'LOSS',
      pointsEarned: won ? r.pointsAwarded : 0,
    };
  });

  return (
    <NavShell>
      <div className={styles.page}>
        <Card className={styles.publicHeroCard}>
          <div className={styles.publicHeroImage}>
            <DroneImage drone={drone} />
          </div>
          <div className={styles.publicHeroInfo}>
            <h1 className={styles.publicName}>{drone.name}</h1>
            <div className={styles.publicMetaLine}>
              <Badge variant="level" value={drone.level} />
              {drone.owner?.username ? (
                <>
                  <span className={styles.metaSep}>|</span>
                  <span className={styles.metaOwner}>
                    Owner:{' '}
                    <Link
                      href={`/profile/${drone.owner.id}`}
                      className={styles.ownerLink}
                    >
                      {drone.owner.username}
                    </Link>
                  </span>
                </>
              ) : drone.isBot ? (
                <>
                  <span className={styles.metaSep}>|</span>
                  <span className={styles.metaOwner}>Bot</span>
                </>
              ) : null}
            </div>

            <div className={styles.publicKpis}>
              <PublicKpi label="ELO" value={drone.eloRating} />
              <PublicKpi label="Races" value={drone.totalRaces} />
              <PublicKpi label="Wins" value={drone.wins} />
              <PublicKpi label="Losses" value={drone.losses} />
              <PublicKpi label="Win Rate" value={winRate} />
            </div>

            {listing && (
              <a
                href={`/marketplace?highlight=${listing.id}`}
                className={styles.buyButton}
              >
                <ShoppingCart size={18} />
                Buy on Marketplace —{' '}
                <span className={styles.buyPrice}>
                  {listing.price.toLocaleString()} pts
                </span>
              </a>
            )}
          </div>
        </Card>

        <Card className={styles.publicStatsCard}>
          <h2 className={styles.sectionHeading}>Stats</h2>
          <div className={styles.publicStatsGrid}>
            {STAT_KEYS.map((key) => (
              <StatBar
                key={key}
                label={STAT_LABELS[key]}
                value={stats[key]}
                maxValue={100}
                size="md"
              />
            ))}
          </div>
        </Card>

        <Card className={styles.historyCard}>
          <h2 className={styles.sectionHeading}>Race History (Last 10 races)</h2>
          <RaceHistoryTable rows={raceRows} />
        </Card>
      </div>
    </NavShell>
  );
}

/* ==========================================================================
 * Shared sub-components
 * ========================================================================== */

function RaceHistoryTable({ rows }) {
  return (
    <DataTable
      emptyMessage="No races yet."
      columns={[
        {
          key: 'id',
          label: 'Race ID',
          render: (r) => (
            <Link href={`/races/${r.id}`} className={styles.raceLink}>
              {r.id.slice(-8).toUpperCase()}
            </Link>
          ),
        },
        {
          key: 'opponent',
          label: 'Opponent',
          render: (r) => (
            <span className={styles.mono}>
              {r.opponent ? r.opponent.slice(-8).toUpperCase() : '—'}
            </span>
          ),
        },
        { key: 'trackName', label: 'Track' },
        { key: 'conditions', label: 'Conditions' },
        {
          key: 'result',
          label: 'Result',
          align: 'right',
          render: (r) => (
            <span className={r.result === 'WIN' ? styles.win : styles.loss}>
              {r.result}
            </span>
          ),
        },
        {
          key: 'pointsEarned',
          label: 'Points Earned',
          align: 'right',
          render: (r) => <span className={styles.mono}>{r.pointsEarned}</span>,
        },
      ]}
      data={rows}
    />
  );
}

function RaceProfileColumn({ label, items, tone }) {
  return (
    <div className={styles.raceProfileCol}>
      <div
        className={`${styles.raceProfileColLabel} ${styles[`tone-${tone}`]}`}
      >
        {label}
      </div>
      <div className={styles.raceProfileChips}>
        {items.length === 0 ? (
          <span className={styles.raceProfileEmpty}>—</span>
        ) : (
          items.map((name) => {
            const Icon = CONDITION_ICONS[name] ?? Cloud;
            return (
              <span
                key={name}
                className={`${styles.raceProfileChip} ${styles[`chip-${tone}`]}`}
              >
                <Icon size={11} aria-hidden="true" />
                {name}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}

function PublicKpi({ label, value }) {
  return (
    <div className={styles.publicKpi}>
      <span className={styles.publicKpiLabel}>{label}</span>
      <span className={styles.publicKpiValue}>{value}</span>
    </div>
  );
}

function DroneImage({ drone }) {
  return (
    <img
      src={drone?.imageUrl || '/drones/default.png'}
      alt={drone?.name ?? 'Drone'}
      className={styles.droneImg}
      loading="eager"
    />
  );
}
