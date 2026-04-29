'use client';

import { useEffect } from 'react';
import { Hexagon } from 'lucide-react';
import styles from './not-found.module.css';

export default function Error({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <Hexagon size={48} className={styles.icon} aria-hidden="true" />
        <h1
          className={styles.title}
          style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}
        >
          Something went wrong
        </h1>
        <p className={styles.text}>Please try again.</p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            marginTop: 'var(--space-4)',
            background: 'transparent',
            border: '1px solid var(--accent-primary)',
            color: 'var(--accent-primary)',
            fontFamily: 'var(--font-body)',
            fontWeight: 600,
            fontSize: 'var(--text-sm)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            padding: 'var(--space-3) var(--space-6)',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
          }}
        >
          Try Again
        </button>
      </div>
    </main>
  );
}
