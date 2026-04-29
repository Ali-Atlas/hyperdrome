'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { Hexagon } from 'lucide-react';
import Button from '@/components/ui/Button';
import styles from './page.module.css';

/**
 * Magic-link sign-in form. Rendered only in dev (the page wrapper gates
 * by NODE_ENV; production redirects to /). Same Resend flow that was in
 * place before the demo-only landing pivot.
 */
export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // redirect: false so a Resend send failure surfaces as a result.error
      // here instead of bouncing the user to NextAuth's default error page.
      const result = await signIn('resend', {
        email,
        redirect: false,
        redirectTo: '/dashboard',
      });
      if (result?.error) {
        setError(
          'Could not send login email. Please try again or use Play Demo.',
        );
        setSubmitting(false);
        return;
      }
      window.location.href = '/check-email';
    } catch (err) {
      console.error(err);
      setError(
        'Could not send login email. Please try again or use Play Demo.',
      );
      setSubmitting(false);
    }
  };

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <h1 className={styles.title}>
          <Hexagon
            size={22}
            strokeWidth={3}
            className={styles.titleIcon}
            aria-hidden="true"
          />
          HYPERDROME
        </h1>
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
