import Link from 'next/link';
import { Hexagon } from 'lucide-react';
import styles from '../not-found.module.css';

export const metadata = {
  title: 'Login failed - Hyperdrome',
};

const buttonStyle = {
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
};

export default function AuthErrorPage() {
  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <Hexagon size={48} className={styles.icon} aria-hidden="true" />
        <h1
          className={styles.title}
          style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}
        >
          Login failed
        </h1>
        <p className={styles.text}>
          Something went wrong with authentication. Please try again.
        </p>
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
            marginTop: 'var(--space-4)',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <Link href="/login" style={buttonStyle}>
            Try Again
          </Link>
          <Link href="/" style={buttonStyle}>
            Go Home
          </Link>
        </div>
      </div>
    </main>
  );
}
