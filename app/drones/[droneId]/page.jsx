'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronDown,
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
import StatEditorRow from '@/components/ui/StatEditorRow';
import StatRadar from '@/components/ui/StatRadar';
import Toggle from '@/components/ui/Toggle';
import Button from '@/components/ui/Button';
import DataTable from '@/components/ui/DataTable';
import Skeleton from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/hooks/useSession';
import { cn, getLevelColor } from '@/lib/utils';
import DroneImage from '@/components/ui/DroneImage';
import VoltIcon from '@/components/ui/VoltIcon';
import ModPlaceholder from '@/components/ui/ModPlaceholder';
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

const RADAR_SHORT_LABELS = {
  speed: 'SPD',
  turning: 'TRN',
  acceleration: 'ACC',
  durability: 'DUR',
  nightVision: 'NV',
  batteryCapacity: 'BAT',
  rainHandling: 'RAIN',
  windResistance: 'WIND',
  consistency: 'CST',
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
 * Top-level page - loads drone + listing, routes to management or public view
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

  return (
    <DroneDetailView
      drone={drone}
      isOwner={isOwner}
      listing={listing}
      onReload={load}
    />
  );
}

/* ==========================================================================
 * Unified detail view - same layout for owner and non-owner. Interactive
 * controls (stat +/-, save/reset, set-active toggle, points balance) are
 * gated on isOwner; non-owners see the same layout read-only, plus a
 * "Buy on Marketplace" CTA when an active listing exists for this drone.
 * ========================================================================== */

function DroneDetailView({ drone, isOwner, listing, onReload }) {
  const { showToast } = useToast();
  const { user } = useSession();
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

  // Upgrades are paid from the player's single shared wallet. What's
  // available to spend right now is the user's balance minus any pending
  // staged changes; the drone-level "unspentPoints" column is deprecated.
  const playerPoints = user?.points ?? 0;
  const availablePoints = playerPoints - totalCost;
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

  const [toggleError, setToggleError] = useState(null);
  const toggleActive = async (next) => {
    setTogglePending(true);
    setToggleError(null);
    try {
      const res = await fetch(`/api/drones/${drone.id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: next }),
      });
      const body = await res.json();
      if (!res.ok) {
        const msg = next
          ? 'Max active drones reached'
          : body?.error || 'Toggle failed';
        setToggleError(msg);
      } else {
        await onReload();
      }
    } catch (err) {
      setToggleError(String(err));
    } finally {
      setTogglePending(false);
    }
  };

  useEffect(() => {
    if (!toggleError) return undefined;
    const id = setTimeout(() => setToggleError(null), 3000);
    return () => clearTimeout(id);
  }, [toggleError]);

  const [unboundMods, setUnboundMods] = useState([]);
  const [modActionPending, setModActionPending] = useState(false);
  const [showBindList, setShowBindList] = useState(false);
  const [showSkinList, setShowSkinList] = useState(false);
  const [showSwapList, setShowSwapList] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    fetch('/api/mods')
      .then((r) => r.json())
      .then((body) => {
        if (cancelled || !body?.data) return;
        setUnboundMods(body.data.filter((m) => !m.boundDroneId));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOwner, drone.id, drone.appliedModId]);

  const equipModFn = async (modId) => {
    if (!modId || modId === drone.appliedModId) return;
    setModActionPending(true);
    try {
      const res = await fetch(`/api/drones/${drone.id}/mods/equip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mod_id: modId }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body?.error || 'Equip failed', 'error');
      } else {
        showToast('Mod equipped', 'success');
        await onReload();
      }
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setModActionPending(false);
    }
  };

  const bindModFn = async (modId) => {
    setModActionPending(true);
    setShowBindList(false);
    try {
      const res = await fetch(`/api/drones/${drone.id}/mods/bind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mod_id: modId }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body?.error || 'Bind failed', 'error');
      } else {
        showToast('Mod bound to drone', 'success');
        await onReload();
      }
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setModActionPending(false);
    }
  };

  const performance = useMemo(
    () => analyzeDronePerformance(editedStats),
    [editedStats],
  );

  const radarLabels = useMemo(
    () => STAT_KEYS.map((key) => RADAR_SHORT_LABELS[key]),
    [],
  );

  const formInfo = useMemo(() => {
    const races = drone.recentRaces ?? [];
    if (!races.length) return { dots: [], streak: 0, type: null };
    const last5 = races.slice(0, 5);
    const dots = last5.map((r) => r.winnerDroneId === drone.id);
    const first = dots[0];
    let streak = 1;
    for (let i = 1; i < dots.length; i++) {
      if (dots[i] === first) streak += 1;
      else break;
    }
    return { dots, streak, type: first ? 'W' : 'L' };
  }, [drone]);

  const winRate =
    drone.totalRaces > 0
      ? ((drone.wins / drone.totalRaces) * 100).toFixed(1) + '%'
      : '-';

  const inPendingRace = (drone.recentRaces ?? []).some(
    (r) => r.status === 'pending',
  );

  const raceRows = (drone.recentRaces ?? []).map((r) => {
    const isDrone1 = r.drone1Id === drone.id;
    const won = r.winnerDroneId === drone.id;
    return {
      id: r.id,
      opponent: isDrone1 ? r.drone2Id : r.drone1Id,
      trackName: r.track?.name ?? '-',
      conditions: `${r.weather} / ${r.timeOfDay}`,
      result: won ? 'WIN' : 'LOSS',
      pointsEarned: won ? r.pointsAwarded : 0,
    };
  });

  return (
    <NavShell>
      <div className={styles.page}>
        <div className={styles.main}>
          <Card
            className={cn(
              styles.leftPanel,
              drone.appliedSkin?.rarity &&
                drone.appliedSkin.rarity !== 'common' &&
                styles[`skinRarity_${drone.appliedSkin.rarity}`],
            )}
          >
            <h2 className={styles.sectionHeading}>Drone</h2>
            <div className={styles.leftInner}>
              <div className={styles.droneNameBlock}>
                <div className={styles.droneNameMeta}>
                  <div className={styles.droneName}>{drone.name}</div>
                  <div className={styles.droneLevel}>
                    <span
                      className={styles.metaLevel}
                      style={{ color: getLevelColor(drone.level) }}
                    >
                      LV {drone.level}
                    </span>
                    <span className={styles.metaSep}>|</span>
                    <span className={styles.metaOwner}>
                      Owner:{' '}
                      {drone.owner?.username ? (
                        !isOwner && drone.owner.id ? (
                          <Link
                            href={`/profile/${drone.owner.id}`}
                            className={styles.ownerLink}
                          >
                            {drone.owner.username}
                          </Link>
                        ) : (
                          drone.owner.username
                        )
                      ) : drone.isBot ? (
                        'Bot'
                      ) : (
                        '-'
                      )}
                    </span>
                  </div>
                </div>
                {isOwner && (
                  <div className={styles.activeControl}>
                    <span className={styles.activeControlLabel}>Active</span>
                    <Toggle
                      checked={drone.active}
                      onChange={toggleActive}
                      disabled={togglePending || inPendingRace}
                    />
                    {inPendingRace && (
                      <span className={styles.activeControlNote}>
                        In active race
                      </span>
                    )}
                    {toggleError && !inPendingRace && (
                      <span className={styles.activeControlError}>
                        {toggleError}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className={styles.droneImageFrame}>
                <DroneImage
                  drone={drone}
                  alt={drone?.name ?? 'Drone'}
                  className={styles.droneImg}
                  loading="eager"
                />
              </div>

              <div className={styles.droneBody}>
                <StatRadar
                  axes={STAT_KEYS}
                  stats={editedStats}
                  labels={radarLabels}
                  className={styles.radar}
                  maxValue={cap}
                />

                <div className={styles.droneMeta}>
                  <div className={styles.formStrip}>
                    <span className={styles.formLabel}>Form</span>
                    <div className={styles.formDots}>
                      {formInfo.dots.length > 0 ? (
                        formInfo.dots.map((won, i) => (
                          <span
                            key={i}
                            className={cn(
                              styles.formDot,
                              won ? styles.formDotWin : styles.formDotLoss,
                            )}
                            aria-label={won ? 'Win' : 'Loss'}
                          />
                        ))
                      ) : (
                        <span className={styles.formEmpty}>-</span>
                      )}
                    </div>
                    {formInfo.dots.length > 0 && (
                      <span
                        className={cn(
                          styles.formStreak,
                          formInfo.type === 'W'
                            ? styles.formStreakWin
                            : styles.formStreakLoss,
                        )}
                      >
                        {formInfo.type}
                        {formInfo.streak}
                      </span>
                    )}
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
                      <span className={styles.statStripValue}>
                        {drone.wins}
                      </span>
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
                      <span className={styles.statStripLabel}>
                        Volts Invested
                      </span>
                      <span className={styles.statStripValue}>
                        {drone.totalPointsInvested ?? 0}
                      </span>
                    </div>
                  </div>

                  <div className={styles.skinBlock}>
                    <span className={styles.skinLabel}>Skin Equipped</span>
                    <button
                      type="button"
                      className={styles.skinSelect}
                      onClick={() => setShowSkinList((v) => !v)}
                      disabled={!isOwner}
                      aria-expanded={showSkinList}
                    >
                      <span className={styles.skinSwatch} aria-hidden="true" />
                      <span className={styles.skinName}>
                        {drone.appliedSkin?.name ?? 'None'}
                      </span>
                      {isOwner && (
                        <ChevronDown size={14} aria-hidden="true" />
                      )}
                    </button>
                    {showSkinList && (
                      <ul className={styles.skinList}>
                        {drone.appliedSkin ? (
                          <li className={styles.skinListItem}>
                            <span className={styles.skinListName}>
                              {drone.appliedSkin.name}
                            </span>
                            <span className={styles.skinListNote}>
                              Permanently bound
                            </span>
                          </li>
                        ) : (
                          <li className={styles.skinListEmpty}>
                            No skins available -{' '}
                            <Link
                              href="/marketplace"
                              className={styles.skinListLink}
                            >
                              visit marketplace
                            </Link>
                          </li>
                        )}
                      </ul>
                    )}
                  </div>

                  <div className={styles.modBlock}>
                    <span className={styles.modLabel}>Mod Equipped</span>
                    <button
                      type="button"
                      className={styles.modSelector}
                      onClick={() => setShowSwapList((v) => !v)}
                      disabled={
                        !isOwner ||
                        modActionPending ||
                        !drone.boundMods ||
                        drone.boundMods.length === 0
                      }
                      aria-expanded={showSwapList}
                    >
                      <ModPlaceholder
                        rarity={drone.appliedMod?.rarity ?? 'common'}
                        size={36}
                      />
                      <div className={styles.modCurrentText}>
                        <span className={styles.modName}>
                          {drone.appliedMod?.name ?? 'None'}
                        </span>
                        {drone.appliedMod?.description && (
                          <span className={styles.modEffect}>
                            {drone.appliedMod.description}
                          </span>
                        )}
                      </div>
                      {isOwner && drone.boundMods?.length > 0 && (
                        <ChevronDown size={14} aria-hidden="true" />
                      )}
                    </button>
                    {showSwapList && drone.boundMods?.length > 0 && (
                      <ul className={styles.modSwapList}>
                        {drone.boundMods.map((m) => (
                          <li key={m.id}>
                            <button
                              type="button"
                              className={styles.modSwapItem}
                              onClick={() => {
                                setShowSwapList(false);
                                equipModFn(m.id);
                              }}
                              disabled={modActionPending}
                            >
                              <span className={styles.modSwapName}>
                                {m.name}
                              </span>
                              <span
                                className={cn(
                                  styles.modSwapRarity,
                                  styles[`modBindRarity_${m.rarity}`],
                                )}
                              >
                                {m.rarity}
                              </span>
                              {m.id === drone.appliedModId && (
                                <span className={styles.modSwapCurrent}>
                                  current
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {(!drone.boundMods || drone.boundMods.length === 0) && (
                      <span className={styles.modEmpty}>
                        NONE -{' '}
                        <Link href="/marketplace" className={styles.modEmptyLink}>
                          visit marketplace
                        </Link>
                      </span>
                    )}

                    {isOwner && unboundMods.length > 0 && (
                      <div className={styles.modBindWrap}>
                        <button
                          type="button"
                          className={styles.modBindBtn}
                          onClick={() => setShowBindList((v) => !v)}
                          disabled={modActionPending}
                        >
                          Bind New Mod ({unboundMods.length})
                        </button>
                        {showBindList && (
                          <ul className={styles.modBindList}>
                            {unboundMods.map((m) => (
                              <li key={m.id}>
                                <button
                                  type="button"
                                  className={styles.modBindItem}
                                  onClick={() => bindModFn(m.id)}
                                  disabled={modActionPending}
                                >
                                  <span className={styles.modBindName}>
                                    {m.name}
                                  </span>
                                  <span
                                    className={cn(
                                      styles.modBindRarity,
                                      styles[`modBindRarity_${m.rarity}`],
                                    )}
                                  >
                                    {m.rarity}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <div className={styles.rightStack}>
            <Card className={styles.rightPanel}>
              <div className={styles.statHeader}>
                <h2 className={styles.sectionHeading}>
                  {isOwner ? 'Stat Editor' : 'Stats'}
                </h2>
                {isOwner && (
                  <div className={styles.availablePoints}>
                    Available{' '}
                    <span className={styles.availableValue}>
                      <VoltIcon size={13} />
                      {availablePoints}
                    </span>
                    <span className={styles.balanceNote}>
                      Your balance: <VoltIcon size={11} />
                      {playerPoints}
                    </span>
                  </div>
                )}
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
                    readOnly={!isOwner}
                  />
                ))}
              </div>

              {isOwner ? (
                <div className={styles.actions}>
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
              ) : listing ? (
                <div className={styles.actions}>
                  <a
                    href={`/marketplace?highlight=${listing.id}`}
                    className={styles.buyButton}
                  >
                    <ShoppingCart size={11} />
                    Buy{' '}
                    <span className={styles.buyPrice}>
                      <VoltIcon size={11} />
                      {listing.price.toLocaleString()}
                    </span>
                  </a>
                </div>
              ) : null}
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
              {r.opponent ? r.opponent.slice(-8).toUpperCase() : '-'}
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
          label: 'Volts Earned',
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
          <span className={styles.raceProfileEmpty}>-</span>
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

