'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import Button from '@/components/ui/Button';
import styles from './not-found.module.css';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('[error boundary]', error);
  }, [error]);

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <AlertTriangle size={48} className={styles.icon} aria-hidden="true" />
        <h1 className={styles.title}>Something broke</h1>
        <p className={styles.text}>
          {error?.message || 'An unexpected error occurred.'}
        </p>
        <Button variant="primary" size="md" onClick={reset}>
          Retry
        </Button>
      </div>
    </main>
  );
}
