'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Check,
  X,
} from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
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
import SkinThumb from '@/components/ui/SkinThumb';
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
  const [unboundSkins, setUnboundSkins] = useState([]);
  const [modActionPending, setModActionPending] = useState(false);
  const [skinActionPending, setSkinActionPending] = useState(false);
  const [showSwapSkinList, setShowSwapSkinList] = useState(false);
  const [showSwapList, setShowSwapList] = useState(false);
  const [showSkinBindModal, setShowSkinBindModal] = useState(false);
  const [showModBindModal, setShowModBindModal] = useState(false);
  const skinSelectorRef = useRef(null);
  const modSelectorRef = useRef(null);

  // Close the skin / mod swap dropdowns when the user clicks outside
  // their wrapper or hits Escape. Listener only attaches while one of
  // the menus is open, so we don't burn a global handler on every page.
  useEffect(() => {
    if (!showSwapSkinList && !showSwapList) return undefined;
    const handlePointerDown = (e) => {
      if (
        showSwapSkinList &&
        skinSelectorRef.current &&
        !skinSelectorRef.current.contains(e.target)
      ) {
        setShowSwapSkinList(false);
      }
      if (
        showSwapList &&
        modSelectorRef.current &&
        !modSelectorRef.current.contains(e.target)
      ) {
        setShowSwapList(false);
      }
    };
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        setShowSwapSkinList(false);
        setShowSwapList(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showSwapSkinList, showSwapList]);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    Promise.all([
      fetch('/api/mods').then((r) => r.json()).catch(() => null),
      fetch('/api/skins').then((r) => r.json()).catch(() => null),
    ]).then(([modsRes, skinsRes]) => {
      if (cancelled) return;
      if (modsRes?.data) {
        setUnboundMods(modsRes.data.filter((m) => !m.boundDroneId));
      }
      if (skinsRes?.data) {
        setUnboundSkins(skinsRes.data.filter((s) => !s.boundDroneId));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOwner, drone.id, drone.appliedModId, drone.appliedSkinId]);

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

  const equipSkinFn = async (skinId) => {
    if (!skinId || skinId === drone.appliedSkinId) return;
    setSkinActionPending(true);
    try {
      const res = await fetch('/api/skins/equip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drone_id: drone.id, skin_id: skinId }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body?.error || 'Equip failed', 'error');
      } else {
        showToast('Skin equipped', 'success');
        await onReload();
      }
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setSkinActionPending(false);
    }
  };

  const bindSkinFn = async (skinId) => {
    setSkinActionPending(true);
    setShowBindSkinList(false);
    try {
      const res = await fetch('/api/skins/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drone_id: drone.id, skin_id: skinId }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body?.error || 'Bind failed', 'error');
      } else {
        showToast('Skin bound to drone', 'success');
        await onReload();
      }
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setSkinActionPending(false);
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
          <Card className={styles.leftPanel}>
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
                    <span
                      className={cn(
                        styles.activeToggleWrap,
                        inPendingRace && styles.activeToggleLocked,
                      )}
                      data-tooltip="In active race"
                    >
                      <Toggle
                        checked={drone.active}
                        onChange={toggleActive}
                        disabled={togglePending || inPendingRace}
                        className={styles.activeToggle}
                      />
                    </span>
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

                </div>
              </div>

              <div className={styles.collectibleRow}>
                <div className={styles.skinBlock}>
                  <span className={styles.skinLabel}>Skin Equipped</span>
                  <div className={styles.modSelectorWrap} ref={skinSelectorRef}>
                    <button
                      type="button"
                      className={cn(
                        styles.modSelector,
                        drone.appliedSkin?.rarity &&
                          styles[`modSelector_${drone.appliedSkin.rarity}`],
                      )}
                      onClick={() => setShowSwapSkinList((v) => !v)}
                      disabled={
                        skinActionPending ||
                        (!(drone.boundSkins?.length > 0) &&
                          !(isOwner && unboundSkins.length > 0)) ||
                        (!isOwner && !listing)
                      }
                      aria-expanded={showSwapSkinList}
                    >
                      {drone.appliedSkin ? (
                        <SkinThumb
                          skin={drone.appliedSkin}
                          rarity={drone.appliedSkin.rarity}
                          alt={drone.appliedSkin.name}
                          className={styles.skinSwatch}
                        />
                      ) : (
                        <span className={styles.skinSwatch} aria-hidden="true" />
                      )}
                      <div className={styles.modCurrentText}>
                        <span className={styles.modName}>
                          {drone.appliedSkin?.name ?? 'None'}
                        </span>
                      </div>
                      {((isOwner && (drone.boundSkins?.length > 0 || unboundSkins.length > 0)) ||
                        (listing && drone.boundSkins?.length > 0)) && (
                        <ChevronDown size={14} aria-hidden="true" />
                      )}
                    </button>
                    {showSwapSkinList &&
                      (drone.boundSkins?.length > 0 ||
                        (isOwner && unboundSkins.length > 0)) && (
                        <ul className={styles.modSwapList}>
                          {isOwner && (
                            <li>
                              <button
                                type="button"
                                className={cn(
                                  styles.modSwapItem,
                                  styles.modSwapItemBind,
                                )}
                                onClick={() => {
                                  setShowSwapSkinList(false);
                                  setShowSkinBindModal(true);
                                }}
                                disabled={
                                  skinActionPending ||
                                  unboundSkins.length === 0
                                }
                              >
                                <span className={styles.modSwapName}>
                                  + Bind New Skin
                                </span>
                                <span className={styles.modSwapCount}>
                                  ({unboundSkins.length})
                                </span>
                              </button>
                            </li>
                          )}
                          {[...(drone.boundSkins ?? [])]
                            .sort((a, b) => {
                              if (a.id === drone.appliedSkinId) return -1;
                              if (b.id === drone.appliedSkinId) return 1;
                              return 0;
                            })
                            .map((s) => (
                              <li key={s.id}>
                                <button
                                  type="button"
                                  className={cn(
                                    styles.modSwapItem,
                                    styles[`modSwapItem_${s.rarity}`],
                                  )}
                                  onClick={() => {
                                    setShowSwapSkinList(false);
                                    if (isOwner) equipSkinFn(s.id);
                                  }}
                                  disabled={skinActionPending || !isOwner}
                                >
                                  <SkinThumb
                                    skin={s}
                                    rarity={s.rarity}
                                    alt={s.name}
                                    className={styles.modSwapIcon}
                                  />
                                  <span className={styles.modSwapName}>
                                    {s.name}
                                  </span>
                                  <span
                                    className={cn(
                                      styles.modSwapRarity,
                                      styles[`modBindRarity_${s.rarity}`],
                                    )}
                                  >
                                    {s.rarity}
                                  </span>
                                  {s.id === drone.appliedSkinId && (
                                    <span className={styles.modSwapCurrent}>
                                      current
                                    </span>
                                  )}
                                </button>
                              </li>
                            ))}
                        </ul>
                      )}
                  </div>
                  {isOwner &&
                    !(drone.boundSkins?.length > 0) &&
                    unboundSkins.length === 0 && (
                      <span className={styles.modEmpty}>
                        NONE -{' '}
                        <Link
                          href="/marketplace"
                          className={styles.modEmptyLink}
                        >
                          visit marketplace
                        </Link>
                      </span>
                    )}
                </div>

                <div className={styles.modBlock}>
                  <span className={styles.modLabel}>Mod Equipped</span>
                  <div className={styles.modSelectorWrap} ref={modSelectorRef}>
                    <button
                      type="button"
                      className={cn(
                        styles.modSelector,
                        drone.appliedMod?.rarity &&
                          styles[`modSelector_${drone.appliedMod.rarity}`],
                      )}
                      onClick={() => setShowSwapList((v) => !v)}
                      disabled={
                        modActionPending ||
                        (!(drone.boundMods?.length > 0) &&
                          !(isOwner && unboundMods.length > 0)) ||
                        (!isOwner && !listing)
                      }
                      aria-expanded={showSwapList}
                    >
                      <ModPlaceholder
                        rarity={drone.appliedMod?.rarity ?? 'common'}
                        size={20}
                        className={styles.modSelectorIcon}
                      />
                      <div className={styles.modCurrentText}>
                        <span className={styles.modName}>
                          {drone.appliedMod?.name ?? 'None'}
                        </span>
                      </div>
                      {((isOwner && (drone.boundMods?.length > 0 || unboundMods.length > 0)) ||
                        (listing && drone.boundMods?.length > 0)) && (
                        <ChevronDown size={14} aria-hidden="true" />
                      )}
                    </button>
                    {showSwapList &&
                      (drone.boundMods?.length > 0 ||
                        (isOwner && unboundMods.length > 0)) && (
                        <ul className={styles.modSwapList}>
                          {isOwner && (
                            <li>
                              <button
                                type="button"
                                className={cn(
                                  styles.modSwapItem,
                                  styles.modSwapItemBind,
                                )}
                                onClick={() => {
                                  setShowSwapList(false);
                                  setShowModBindModal(true);
                                }}
                                disabled={
                                  modActionPending || unboundMods.length === 0
                                }
                              >
                                <span className={styles.modSwapName}>
                                  + Bind New Mod
                                </span>
                                <span className={styles.modSwapCount}>
                                  ({unboundMods.length})
                                </span>
                              </button>
                            </li>
                          )}
                          {[...(drone.boundMods ?? [])]
                            .sort((a, b) => {
                              if (a.id === drone.appliedModId) return -1;
                              if (b.id === drone.appliedModId) return 1;
                              return 0;
                            })
                            .map((m) => (
                              <li key={m.id}>
                                <button
                                  type="button"
                                  className={cn(
                                    styles.modSwapItem,
                                    styles[`modSwapItem_${m.rarity}`],
                                  )}
                                  onClick={() => {
                                    setShowSwapList(false);
                                    if (isOwner) equipModFn(m.id);
                                  }}
                                  disabled={modActionPending || !isOwner}
                                >
                                  <ModPlaceholder
                                    rarity={m.rarity}
                                    size={20}
                                    className={styles.modSwapIcon}
                                  />
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
                  </div>
                  {isOwner &&
                    !(drone.boundMods?.length > 0) &&
                    unboundMods.length === 0 && (
                      <span className={styles.modEmpty}>
                        NONE -{' '}
                        <Link
                          href="/marketplace"
                          className={styles.modEmptyLink}
                        >
                          visit marketplace
                        </Link>
                      </span>
                    )}
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

      <BindCollectibleModal
        isOpen={showSkinBindModal}
        onClose={() => setShowSkinBindModal(false)}
        kind="skin"
        droneName={drone.name}
        items={unboundSkins}
        onBind={bindSkinFn}
        pending={skinActionPending}
      />
      <BindCollectibleModal
        isOpen={showModBindModal}
        onClose={() => setShowModBindModal(false)}
        kind="mod"
        droneName={drone.name}
        items={unboundMods}
        onBind={bindModFn}
        pending={modActionPending}
      />
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

/* ==========================================================================
 * Bind Collectible Modal - shared by skins + mods. Shows the unbound items
 * with bigger imagery, multi-select checkboxes, a permanence warning, and
 * a single "Bind X" CTA that fires sequential binds. Per Captain: binding
 * is a permanent action - the skin / mod transfers with the drone for life.
 * ========================================================================== */

function BindCollectibleModal({
  isOpen,
  onClose,
  kind,
  droneName,
  items,
  onBind,
  pending,
}) {
  const [selected, setSelected] = useState(new Set());
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!isOpen) setSelected(new Set());
  }, [isOpen]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBind = async () => {
    if (selected.size === 0) return;
    setWorking(true);
    try {
      for (const id of selected) {
        await onBind(id);
      }
    } finally {
      setWorking(false);
      onClose();
    }
  };

  const title = kind === 'skin'
    ? `Bind skins to ${droneName}`
    : `Bind mods to ${droneName}`;
  const empty = !items || items.length === 0;
  const count = selected.size;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" chromeless>
      <div className={styles.bindModalHeader}>
        <h2 className={styles.bindModalTitle}>{title}</h2>
        <button
          type="button"
          className={styles.bindModalClose}
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>
      </div>

      <div className={styles.bindModal}>
        <p className={styles.bindWarning}>
          Binding is permanent. Once bound, this {kind} cannot be moved to
          another drone or sold separately. It transfers with this drone if
          you sell it.
        </p>

        {empty ? (
          <div className={styles.bindEmpty}>
            You don&apos;t have any unbound {kind}s. Visit the{' '}
            <Link href="/marketplace" className={styles.modEmptyLink}>
              marketplace
            </Link>
            .
          </div>
        ) : (
          <div className={styles.bindGrid}>
            {items.map((item) => {
              const isSelected = selected.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    styles.bindCard,
                    styles[`bindCard_${item.rarity}`],
                    isSelected && styles.bindCardSelected,
                  )}
                  onClick={() => toggle(item.id)}
                  disabled={working || pending}
                  aria-pressed={isSelected}
                >
                  <div className={styles.bindCardImage}>
                    {kind === 'skin' ? (
                      <SkinThumb
                        skin={item}
                        rarity={item.rarity}
                        alt={item.name}
                      />
                    ) : (
                      <ModPlaceholder rarity={item.rarity} size={96} />
                    )}
                  </div>
                  <div className={styles.bindCardName}>{item.name}</div>
                  <div
                    className={cn(
                      styles.bindCardRarity,
                      styles[`modBindRarity_${item.rarity}`],
                    )}
                  >
                    {item.rarity}
                  </div>
                  {isSelected && (
                    <span className={styles.bindCardCheck} aria-hidden="true">
                      <Check size={14} strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className={styles.bindFooter}>
          <span className={styles.bindHelp}>
            Read more in the{' '}
            <Link href="/guide" className={styles.modEmptyLink}>
              Guide
            </Link>{' '}
            and{' '}
            <Link href="/faq" className={styles.modEmptyLink}>
              FAQ
            </Link>
            .
          </span>
          <div className={styles.bindActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={working}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleBind}
              disabled={count === 0 || working || pending}
              loading={working}
            >
              {count > 0 ? `Bind ${count} to ${droneName}` : 'Bind'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
