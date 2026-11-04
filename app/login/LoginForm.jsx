'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui';
import { usePlayDemo } from '@/hooks/usePlayDemo';
import styles from './page.module.css';

/** Google sign-in and Play Demo; both land on the dashboard. */
export default function LoginForm() {
  const [google, setGoogle] = useState(false);
  const demo = usePlayDemo();
  const busy = google || demo.loading;

  return (
    <div className={styles.form}>
      <Button
        type="button"
        variant="secondary"
        loading={google}
        disabled={busy}
        onClick={() => {
          setGoogle(true);
          signIn('google', { redirectTo: '/dashboard' });
        }}
      >
        Continue with Google
      </Button>
      <p className={styles.divider}>or</p>
      <Button type="button" loading={demo.loading} disabled={busy} onClick={demo.start}>
        Play Demo
      </Button>
      {demo.error && (
        <p role="alert" className={styles.error}>
          {demo.error}
        </p>
      )}
    </div>
  );
}
