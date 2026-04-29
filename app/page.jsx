import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Crosshair, Hexagon, TrendingUp } from 'lucide-react';
import { auth } from '@/lib/auth';
import VoltIcon from '@/components/ui/VoltIcon';
import HeroActions from './HeroActions';
import styles from './page.module.css';

export const metadata = {
  title: 'Hyperdrome - Competitive Idle Drone Racing',
  description:
    'Drone racing strategy game. Level your drones, grow your fleet, strategize your mods, collect your skins.',
  openGraph: {
    title: 'Hyperdrome - Competitive Idle Drone Racing',
    description:
      'Drone racing strategy game. Level your drones, grow your fleet, strategize your mods, collect your skins.',
    type: 'website',
  },
};

const PACKS = [
  { name: 'Starter',   image: '/skin_packs/starter_pack.webp',   price:   2_000, gold: false },
  { name: 'Premium',   image: '/skin_packs/premium_pack.webp',   price:  25_000, gold: false },
  { name: 'Legendary', image: '/skin_packs/legendary_pack.webp', price: 100_000, gold: true  },
];

const CAPSULES = [
  { name: 'Starter',   image: '/capsules/capsule_starter.webp',   price:  1_000, gold: false },
  { name: 'Premium',   image: '/capsules/capsule_premium.webp',   price: 12_000, gold: false },
  { name: 'Legendary', image: '/capsules/capsule_legendary.webp', price: 50_000, gold: true  },
];

const COLLECT_LEGENDARIES = [
  { name: 'Diamond Hands',  image: '/skins/legendary/diamond_hand.webp' },
  { name: 'Kraken',         image: '/skins/legendary/kraken.webp' },
  { name: 'Apex Predator',  image: '/skins/legendary/apex_predator.webp' },
  { name: 'Celestial',      image: '/skins/legendary/celestial.webp' },
];

export default async function LandingPage() {
  const session = await auth();
  if (session?.user) {
    redirect('/dashboard');
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <video
          autoPlay
          muted
          loop
          playsInline
          poster="/hero-poster.webp"
          className={styles.heroVideo}
          aria-hidden="true"
        >
          <source src="/hero-video.mp4" type="video/mp4" />
        </video>
        <div className={styles.heroOverlay} aria-hidden="true" />

        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle}>HYPERDROME</h1>
          <p className={styles.heroTagline}>Build. Race. Trade. Collect.</p>
          <HeroActions />
        </div>
      </section>

      <section
        className={styles.gameSection}
        aria-labelledby="gameplay-heading"
      >
        <h2 id="gameplay-heading" className={styles.sectionHeading}>
          Gameplay
        </h2>
        <div className={styles.gameGrid}>
          <article className={styles.gameColumn}>
            <Crosshair
              size={32}
              strokeWidth={1.5}
              className={styles.gameColumnIcon}
              aria-hidden="true"
            />
            <h3 className={styles.gameColumnTitle}>1v1 Drone Racing</h3>
            <p className={styles.gameColumnBody}>
              Automated races every 3 minutes. ELO matchmaking pairs
              equally skilled opponents.
            </p>
          </article>

          <article className={styles.gameColumn}>
            <Hexagon
              size={32}
              strokeWidth={1.5}
              className={styles.gameColumnIcon}
              aria-hidden="true"
            />
            <h3 className={styles.gameColumnTitle}>Strategy Matters</h3>
            <p className={styles.gameColumnBody}>
              Drone stats, mods, track conditions, and weather all impact
              outcomes. 2 minutes before each race to swap your loadout.
            </p>
          </article>

          <article className={styles.gameColumn}>
            <TrendingUp
              size={32}
              strokeWidth={1.5}
              className={styles.gameColumnIcon}
              aria-hidden="true"
            />
            <h3 className={styles.gameColumnTitle}>Earn Your Edge</h3>
            <p className={styles.gameColumnBody}>
              Race to earn Volts and XP.{' '}
              <span className={styles.accent}>
                XP only comes from racing
              </span>
              . 3 active drones at a time.
            </p>
          </article>
        </div>
      </section>

      <section
        className={styles.economySection}
        aria-labelledby="economy-heading"
      >
        <div className={styles.economyContent}>
          <h2 id="economy-heading" className={styles.economyBigLine}>
            Everything runs on{' '}
            <span className={styles.economyVoltsToken}>
              <VoltIcon size={20} />
              Volts
            </span>
            .
          </h2>
          <p className={styles.economyBody}>
            Earn Volts by racing. Spend on stat upgrades, skins, mods,
            and packs. Trade on the{' '}
            <span className={styles.accent}>player-driven marketplace</span>.
          </p>
        </div>
      </section>

      <section
        className={styles.modsSection}
        aria-labelledby="mods-heading"
      >
        <h2 id="mods-heading" className={styles.sectionHeading}>
          Mods
        </h2>
        <p className={styles.packsBody}>
          Functional stat modifiers with real tradeoffs.{' '}
          <span className={styles.accent}>
            Boost one stat, penalize another
          </span>
          . Equip before each race in the 2-minute strategy window.
        </p>
        <ul className={styles.packsRow}>
          {CAPSULES.map((capsule) => (
            <li key={capsule.name} className={styles.packItem}>
              <img
                src={capsule.image}
                alt={`${capsule.name} mod capsule`}
                className={styles.packImage}
              />
              <span
                className={
                  capsule.gold
                    ? `${styles.packLabel} ${styles.accentGold}`
                    : styles.packLabel
                }
              >
                {capsule.name}
              </span>
              <span
                className={
                  capsule.gold
                    ? `${styles.packPrice} ${styles.accentGold}`
                    : styles.packPrice
                }
              >
                <VoltIcon size={14} />
                {capsule.price.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section
        className={styles.packsSection}
        aria-labelledby="packs-heading"
      >
        <h2 id="packs-heading" className={styles.packsHeading}>
          Open packs. Chase legendaries.
        </h2>
        <p className={styles.packsBody}>
          <span className={styles.accent}>3 skins per pack</span>. The{' '}
          <span className={styles.accentGold}>legendary pack</span>{' '}
          guarantees one legendary skin.
        </p>
        <ul className={styles.packsRow}>
          {PACKS.map((pack) => (
            <li key={pack.name} className={styles.packItem}>
              <img
                src={pack.image}
                alt={`${pack.name} skin pack`}
                className={styles.packImage}
              />
              <span
                className={
                  pack.gold
                    ? `${styles.packLabel} ${styles.accentGold}`
                    : styles.packLabel
                }
              >
                {pack.name}
              </span>
              <span
                className={
                  pack.gold
                    ? `${styles.packPrice} ${styles.accentGold}`
                    : styles.packPrice
                }
              >
                <VoltIcon size={14} />
                {pack.price.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section
        className={styles.collectSection}
        aria-labelledby="collect-heading"
      >
        <h2 id="collect-heading" className={styles.sectionHeading}>
          Collect
        </h2>
        <p className={styles.collectBodySmall}>
          4 drone tiers. Common, rare, and epic skins. Functional mods
          with real stat tradeoffs.
        </p>
        <p className={styles.collectBodyMid}>
          <span className={styles.accentGold}>Legendary skins</span> are
          unique drones entirely.
        </p>
        <p className={styles.collectBodyLegendary}>
          8 legendaries in Season 1
        </p>
        <ul className={styles.collectDronesRow}>
          {COLLECT_LEGENDARIES.map((legendary) => (
            <li key={legendary.name} className={styles.collectDroneItem}>
              <img
                src={legendary.image}
                alt={legendary.name}
                className={styles.collectDroneImage}
              />
              <span className={styles.collectDroneCaption}>
                {legendary.name}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <footer className={styles.footer}>
        <p className={styles.footerCopy}>
          <span className={styles.footerBrand}>Hyperdrome</span> is a
          Dendrite Games title. © 2026
        </p>
        <p className={styles.footerLinks}>
          <Link href="/guide" className={styles.footerLink}>
            Guide
          </Link>
          <span className={styles.footerDot} aria-hidden="true">
            ·
          </span>
          <Link href="/faq" className={styles.footerLink}>
            FAQ
          </Link>
        </p>
      </footer>
    </div>
  );
}
