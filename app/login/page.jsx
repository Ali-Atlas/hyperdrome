'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import Button from '@/components/ui/Button';
import styles from './page.module.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn('resend', {
        email,
        redirectTo: '/dashboard',
      });
    } catch (err) {
      console.error(err);
      setError('Could not send sign-in link. Try again.');
      setSubmitting(false);
    }
  };

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <h1 className={styles.title}>Drone Manager</h1>
        <p className={styles.subtitle}>
          Enter your email to receive a sign-in link.
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label}>
            <span className={styles.labelText}>Email</span>
            <input
              type="email"
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              autoFocus
              disabled={submitting}
            />
          </label>

          {error && <p className={styles.error}>{error}</p>}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            disabled={!email}
            className={styles.submit}
          >
            Send magic link
          </Button>
        </form>

        <p className={styles.note}>
          No passwords. No social login. Just click the link we email you.
        </p>
      </div>
    </main>
  );
}
