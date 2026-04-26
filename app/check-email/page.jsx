import Link from 'next/link';
import { Mail } from 'lucide-react';
import styles from './page.module.css';

export const metadata = {
  title: 'Check your email - Hyperdrome',
};

export default function CheckEmailPage() {
  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <Mail className={styles.icon} size={48} aria-hidden="true" />
        <h1 className={styles.title}>Check your email</h1>
        <p className={styles.description}>
          We sent a sign-in link to your inbox. Click it to access your drones.
        </p>
        <Link href="/login" className={styles.back}>
          ← Back to sign in
        </Link>
      </div>
    </main>
  );
}
