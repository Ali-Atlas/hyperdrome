'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui';
import styles from './page.module.css';

/** Google button and magic-link email form; both land on the dashboard. */
export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(/** @type {null | 'google' | 'email'} */ (null));

  /** @param {React.FormEvent<HTMLFormElement>} e */
  async function sendLink(e) {
    e.preventDefault();
    setBusy('email');
    await signIn('resend', { email, redirectTo: '/dashboard' });
  }

  return (
    <div className={styles.form}>
      <Button
        type="button"
        variant="secondary"
        loading={busy === 'google'}
        disabled={busy !== null}
        onClick={() => {
          setBusy('google');
          signIn('google', { redirectTo: '/dashboard' });
        }}
      >
        Continue with Google
      </Button>
      <p className={styles.divider}>or</p>
      <form onSubmit={sendLink} className={styles.emailForm}>
        <label htmlFor="email" className={styles.label}>
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={styles.input}
        />
        <Button type="submit" loading={busy === 'email'} disabled={busy !== null}>
          Email me a sign-in link
        </Button>
      </form>
    </div>
  );
}
