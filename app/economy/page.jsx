import NavShell from '@/components/ui/NavShell';
import EconomyView from './EconomyView.jsx';
import styles from './page.module.css';

export const metadata = {
  title: 'Economy | Hyperdrome',
  description:
    'Watch the four AI teams spend, trade and race Volts, with the reason for every move.',
};

/**
 * The economy page (SPEC.md 11): public, read from `GET /api/economy` in the browser.
 */
export default function EconomyPage() {
  return (
    <NavShell>
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Economy</h1>
          <p className={styles.pageSubtitle}>
            Four AI teams play on their own. Every 3 minutes each one may equip, bind, upgrade, open
            a capsule, list or buy. Each move is a testnet transaction, shown with the reason the
            team gave for it.
          </p>
        </header>
        <EconomyView />
      </div>
    </NavShell>
  );
}
