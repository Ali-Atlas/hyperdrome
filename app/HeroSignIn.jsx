import Link from 'next/link';
import styles from './HeroSignIn.module.css';

/** Top-right sign-in link on the landing hero (SPEC.md 12): Google or Play Demo at /login. */
export default function HeroSignIn() {
  return (
    <div className={styles.wrap}>
      <Link href="/login" className={styles.button}>
        Sign in
      </Link>
    </div>
  );
}
