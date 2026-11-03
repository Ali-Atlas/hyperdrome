import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import LoginForm from './LoginForm';
import styles from './page.module.css';

export const metadata = { title: 'Sign in | Hyperdrome' };

/**
 * Sign-in (SPEC.md 12): Google or an email magic link. `?sent=1` is Auth.js's verify-request page.
 * @param {{ searchParams: Promise<{ sent?: string }> }} props
 */
export default async function LoginPage({ searchParams }) {
  if ((await auth())?.user) redirect('/dashboard');
  const { sent } = await searchParams;
  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <h1 className={styles.title}>Sign in</h1>
        {sent ? (
          <p className={styles.note}>
            Check your email for a sign-in link. It expires in 24 hours.
          </p>
        ) : (
          <LoginForm />
        )}
      </section>
    </main>
  );
}
