import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import styles from './page.module.css';

const CONTACT_EMAIL = 'walletbot234@gmail.com';

export const metadata = {
  title: 'Privacy | Hyperdrome',
  description: 'What Hyperdrome stores, who hosts it and how to have it deleted.',
};

const STORED = [
  'Google sign-in: your Google account email, name and profile image, through Auth.js. Play Demo needs no Google account and uses a generated name.',
  'Game data: your username, drones, skins, mods, Volts, races, listings and the actions you take.',
  'NEAR account: the game creates one NEAR testnet account for you. Its keys are held on the server, encrypted with AES-256-GCM.',
  'IP address: Play Demo stores a salted hash of your IP address to limit new demo accounts per hour. The database never holds the IP address itself.',
  'Cookies: Auth.js sets a session cookie that keeps you signed in, and short-lived cookies during sign-in. Your browser also keeps small flags for the tour and the race countdown. There are no advertising cookies.',
  'Analytics: Vercel Web Analytics counts page views. It uses no third-party cookies, and its visitor hash is discarded after 24 hours.',
];

const SHARED = [
  'Nothing is sold.',
  'Data goes only to the providers that host the game: Vercel (the app and analytics), Neon (the database) and the NEAR RPC providers dRPC and FastNear (chain access).',
  'Your NEAR account and its game transactions are public on the NEAR testnet and appear in explorers such as NearBlocks. Your username, drones and race results are visible to other players.',
];

/**
 * The privacy page: what the game stores, testnet status, who hosts it and how to ask for deletion.
 */
export default function PrivacyPage() {
  return (
    <NavShell>
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Privacy</h1>
          <p className={styles.pageSubtitle}>Last updated 2026-11-08.</p>
        </header>

        <div className={styles.sections}>
          <Card className={styles.sectionCard}>
            <h2 className={styles.sectionHeading}>Testnet only</h2>
            <p className={styles.text}>
              Hyperdrome runs on the NEAR testnet. Volts, drones and items have no monetary value.
            </p>
          </Card>

          <Card className={styles.sectionCard}>
            <h2 className={styles.sectionHeading}>What is stored</h2>
            <ul className={styles.list}>
              {STORED.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Card>

          <Card className={styles.sectionCard}>
            <h2 className={styles.sectionHeading}>Who sees it</h2>
            <ul className={styles.list}>
              {SHARED.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Card>

          <Card className={styles.sectionCard}>
            <h2 className={styles.sectionHeading}>Deletion and contact</h2>
            <p className={styles.text}>
              Email{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className={styles.link}>
                {CONTACT_EMAIL}
              </a>{' '}
              to have your account data deleted from the game&apos;s database. Records on the NEAR
              testnet are permanent and cannot be removed.
            </p>
          </Card>
        </div>
      </div>
    </NavShell>
  );
}
