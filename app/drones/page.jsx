'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import StatBar from '@/components/ui/StatBar';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import styles from './page.module.css';

export default function DronesPage() {
  const [drones, setDrones] = useState([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <NavShell>
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>My Drones</h1>
          <p className={styles.subtitle}>
            {loading ? 'Loading…' : `${drones.length} drone${drones.length === 1 ? '' : 's'} in garage`}
          </p>
        </header>

        {loading ? (
          <div className={styles.grid}>
            <Skeleton variant="card" height={220} />
            <Skeleton variant="card" height={220} />
            <Skeleton variant="card" height={220} />
          </div>
        ) : drones.length === 0 ? (
          <EmptyState
            title="No drones yet"
            description="Your starter drone is created on first sign-in. Log out and in again if this is unexpected."
          />
        ) : (
          <div className={styles.grid}>
            {drones.map((drone) => (
              <Link
                key={drone.id}
                href={`/drones/${drone.id}`}
                className={styles.cardLink}
              >
                <Card
                  hover
                  className={`${styles.droneCard} ${drone.active ? styles.active : ''}`}
                >
                  {drone.active && <span className={styles.activeDot} aria-label="Active" />}
                  <div className={styles.droneHeader}>
                    <h2 className={styles.droneName}>{drone.name}</h2>
                    <Badge variant="level" value={drone.level} />
                  </div>
                  <div className={styles.droneMeta}>
                    ELO {drone.eloRating} · W {drone.wins} / L {drone.losses}
                  </div>
                  <div className={styles.stats}>
                    <StatBar label="Speed" value={drone.speed} maxValue={100} size="sm" />
                    <StatBar label="Turning" value={drone.turning} maxValue={100} size="sm" />
                    <StatBar label="Accel." value={drone.acceleration} maxValue={100} size="sm" />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </NavShell>
  );
}
