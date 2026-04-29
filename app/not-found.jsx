import Link from 'next/link';
import { Hexagon } from 'lucide-react';
import styles from './not-found.module.css';

export const metadata = {
  title: 'Page not found - Hyperdrome',
};

export default function NotFound() {
  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <Hexagon size={48} className={styles.icon} aria-hidden="true" />
        <h1
          className={styles.title}
          style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}
        >
          Page not found
        </h1>
        <Link
          href="/"
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
            display: 'inline-block',
          }}
        >
          Go Home
        </Link>
      </div>
    </main>
  );
}
