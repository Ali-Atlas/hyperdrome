import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import LoginForm from './LoginForm';
import styles from './page.module.css';

export const metadata = { title: 'Sign in | Hyperdrome' };

/** Sign-in (SPEC.md 12): Google, or Play Demo for a fresh demo account. */
export default async function LoginPage() {
  if ((await auth())?.user) redirect('/dashboard');
  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <h1 className={styles.title}>Sign in</h1>
        <LoginForm />
      </section>
    </main>
  );
}
