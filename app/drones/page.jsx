'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import NavShell from '@/components/ui/NavShell';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';
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
            {loading
              ? 'Loading…'
              : `${drones.length} drone${drones.length === 1 ? '' : 's'} in garage`}
          </p>
        </header>

        {loading ? (
          <div className={styles.grid}>
            <Skeleton variant="card" height={340} />
            <Skeleton variant="card" height={340} />
            <Skeleton variant="card" height={340} />
            <Skeleton variant="card" height={340} />
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
                <div
                  className={cn(styles.droneCard, drone.active && styles.active)}
                >
                  <div className={styles.imageFrame}>
                    <img
                      src={drone.imageUrl || '/drones/default.png'}
                      alt={drone.name}
                      className={styles.droneImg}
                    />
                  </div>
                  <div className={styles.info}>
                    <div className={styles.nameLine}>
                      <h3 className={styles.droneName}>{drone.name}</h3>
                      <div className={styles.chipRow}>
                        {drone.active && (
                          <span className={styles.activeChip}>
                            <span
                              className={styles.activeDot}
                              aria-hidden="true"
                            />
                            Active
                          </span>
                        )}
                        <Badge variant="level" value={drone.level} />
                      </div>
                    </div>
                    <div className={styles.droneMeta}>
                      ELO {drone.eloRating} · W{drone.wins} / L{drone.losses}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </NavShell>
  );
}
