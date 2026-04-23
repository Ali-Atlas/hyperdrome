import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import styles from './not-found.module.css';

export const metadata = {
  title: 'Page not found - Drone Manager',
};

export default function NotFound() {
  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <AlertCircle size={48} className={styles.icon} aria-hidden="true" />
        <h1 className={styles.title}>404</h1>
        <p className={styles.text}>Page not found.</p>
        <Link href="/" className={styles.link}>
          ← Back to home
        </Link>
      </div>
    </main>
  );
}
