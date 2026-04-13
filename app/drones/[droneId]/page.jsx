'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import StatEditorRow from '@/components/ui/StatEditorRow';
import Toggle from '@/components/ui/Toggle';
import Button from '@/components/ui/Button';
import DataTable from '@/components/ui/DataTable';
import Skeleton from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
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

function pickStats(drone) {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, drone[k] ?? 1]));
}

export default function DroneDetailPage({ params }) {
  const { droneId } = use(params);
  const { showToast } = useToast();
  const [drone, setDrone] = useState(null);
  const [editedStats, setEditedStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglePending, setTogglePending] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/drones/${droneId}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || 'Failed to load drone');
      } else {
        setDrone(body.data);
        setEditedStats(pickStats(body.data));
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [droneId]);

  useEffect(() => {
    load();
  }, [load]);

  const baseStats = useMemo(() => (drone ? pickStats(drone) : null), [drone]);
  const level = drone?.level ?? 1;
  const cap = useMemo(() => calculatePerStatCap(level), [level]);
  const tsb = useMemo(() => calculateTSB(level), [level]);

  const totalCost = useMemo(() => {
    if (!baseStats || !editedStats) return 0;
    return STAT_KEYS.reduce(
      (sum, key) =>
        sum + calculateTotalUpgradeCost(baseStats[key], editedStats[key]),
      0,
    );
  }, [baseStats, editedStats]);

  const currentSum = useMemo(
    () =>
      editedStats
        ? STAT_KEYS.reduce((s, k) => s + (editedStats[k] ?? 0), 0)
        : 0,
    [editedStats],
  );

  const availablePoints = (drone?.unspentPoints ?? 0) - totalCost;
  const hasChanges = totalCost > 0;

  const increment = (key) => {
    setEditedStats((prev) => {
      if (!prev) return prev;
      const current = prev[key];
      if (current >= cap) return prev;
      const nextValue = current + 1;
      // Prevent going beyond TSB
      if (currentSum + 1 > tsb) return prev;
      const nextCost = calculateStatUpgradeCost(current);
      if (availablePoints < nextCost) return prev;
      return { ...prev, [key]: nextValue };
    });
  };

  const decrement = (key) => {
    setEditedStats((prev) => {
      if (!prev || !baseStats) return prev;
      if (prev[key] <= baseStats[key]) return prev;
      return { ...prev, [key]: prev[key] - 1 };
    });
  };

  const reset = () => {
    if (baseStats) setEditedStats(baseStats);
  };

  const save = async () => {
    if (!drone || !editedStats || !baseStats) return;
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
        await load();
      }
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (next) => {
    if (!drone) return;
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
        await load();
      }
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setTogglePending(false);
    }
  };

  const performance = useMemo(
    () => (editedStats ? analyzeDronePerformance(editedStats) : null),
    [editedStats],
  );

  if (loading) {
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

  if (error || !drone || !baseStats || !editedStats) {
    return (
      <NavShell>
        <div className={styles.page}>
          <Link href="/drones" className={styles.back}>
            <ArrowLeft size={16} /> Back
          </Link>
          <p className={styles.error}>{error || 'Drone not found'}</p>
        </div>
      </NavShell>
    );
  }

  const raceRows = (drone.recentRaces ?? []).map((r) => {
    const isDrone1 = r.drone1Id === drone.id;
    const won = r.winnerDroneId === drone.id;
    return {
      id: r.id,
      opponentId: isDrone1 ? r.drone2Id : r.drone1Id,
      trackName: r.track?.name ?? '—',
      conditions: `${r.weather} / ${r.timeOfDay}`,
      result: won ? 'WIN' : 'LOSS',
      pointsEarned: won ? r.pointsAwarded : 0,
    };
  });

  return (
    <NavShell>
      <div className={styles.page}>
        <Link href="/drones" className={styles.back}>
          <ArrowLeft size={16} /> Back to My Drones
        </Link>
        <h1 className={styles.title}>Drone Management</h1>

        <div className={styles.main}>
          {/* ---- Left panel ---- */}
          <Card className={styles.leftPanel}>
            <div className={styles.droneImageWrap}>
              <DroneSvg />
            </div>
            <div className={styles.droneHeader}>
              <h2 className={styles.droneName}>{drone.name}</h2>
              <div className={styles.droneMeta}>
                <Badge variant="level" value={drone.level} />
                <span className={styles.ownerLabel}>
                  Owner: {drone.owner?.username ?? '—'}
                </span>
              </div>
            </div>
            <dl className={styles.quickStats}>
              <div>
                <dt>Total Races</dt>
                <dd>{drone.totalRaces}</dd>
              </div>
              <div>
                <dt>Win Rate</dt>
                <dd>
                  {drone.totalRaces > 0
                    ? ((drone.wins / drone.totalRaces) * 100).toFixed(1) + '%'
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>ELO</dt>
                <dd>{drone.eloRating}</dd>
              </div>
            </dl>
            <div className={styles.skinBlock}>
              <div className={styles.skinLabel}>Skin Equipped</div>
              <div className={styles.skinValue}>
                {drone.appliedSkin?.name ?? 'None'}
              </div>
            </div>
          </Card>

          {/* ---- Right panel ---- */}
          <Card className={styles.rightPanel}>
            <div className={styles.statHeader}>
              <h2 className={styles.sectionHeading}>Stat Editor</h2>
              <div className={styles.availablePoints}>
                Available Points:{' '}
                <span className={styles.availableValue}>{availablePoints}</span>
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
              <Toggle
                checked={drone.active}
                onChange={toggleActive}
                disabled={togglePending}
                label={drone.active ? 'Active' : 'Set Active'}
              />
              <div className={styles.buttonGroup}>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={reset}
                  disabled={!hasChanges || saving}
                >
                  Reset
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  onClick={save}
                  disabled={!hasChanges}
                  loading={saving}
                >
                  Save
                </Button>
              </div>
            </div>

            {performance && (
              <div className={styles.perfBlock}>
                <h3 className={styles.perfHeading}>Performance Summary</h3>
                <div className={styles.perfGrid}>
                  <PerfColumn label="Optimal" items={performance.optimal} tone="optimal" />
                  <PerfColumn label="Moderate" items={performance.moderate} tone="moderate" />
                  <PerfColumn label="Poor" items={performance.poor} tone="poor" />
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* ---- Race history ---- */}
        <Card className={styles.historyCard}>
          <h2 className={styles.sectionHeading}>Race History (Last 10)</h2>
          <DataTable
            emptyMessage="No races yet."
            columns={[
              {
                key: 'id',
                label: 'Race ID',
                render: (r) => <span className={styles.mono}>{r.id.slice(-8).toUpperCase()}</span>,
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
                label: 'Points',
                align: 'right',
                render: (r) => <span className={styles.mono}>{r.pointsEarned}</span>,
              },
            ]}
            data={raceRows}
          />
        </Card>
      </div>
    </NavShell>
  );
}

function PerfColumn({ label, items, tone }) {
  return (
    <div className={styles.perfCol}>
      <div className={`${styles.perfColLabel} ${styles[`tone-${tone}`]}`}>
        {label}
      </div>
      <div className={styles.perfChips}>
        {items.length === 0 ? (
          <span className={styles.perfEmpty}>—</span>
        ) : (
          items.map((name) => (
            <span key={name} className={`${styles.perfChip} ${styles[`chip-${tone}`]}`}>
              {name}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function DroneSvg() {
  return (
    <svg
      viewBox="0 0 400 260"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Drone illustration"
      className={styles.droneSvg}
    >
      <defs>
        <linearGradient id="droneBody" x1="0" x2="1">
          <stop offset="0" stopColor="#03DAC6" stopOpacity="0.15" />
          <stop offset="1" stopColor="#03DAC6" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <g stroke="#03DAC6" strokeWidth="1.5" fill="none" opacity="0.9">
        <line x1="80" y1="70" x2="160" y2="130" />
        <line x1="80" y1="190" x2="160" y2="130" />
        <line x1="320" y1="70" x2="240" y2="130" />
        <line x1="320" y1="190" x2="240" y2="130" />
      </g>
      <polygon
        points="160,130 200,90 240,130 200,170"
        fill="url(#droneBody)"
        stroke="#03DAC6"
        strokeWidth="2"
      />
      <g stroke="#03DAC6" strokeWidth="1.5" fill="none" opacity="0.6">
        <circle cx="80" cy="70" r="22" />
        <circle cx="80" cy="190" r="22" />
        <circle cx="320" cy="70" r="22" />
        <circle cx="320" cy="190" r="22" />
      </g>
      <circle cx="200" cy="90" r="3" fill="#03DAC6" />
      <circle cx="200" cy="170" r="3" fill="#03DAC6" />
    </svg>
  );
}
