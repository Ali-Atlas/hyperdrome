import { redirect } from 'next/navigation';
import { Hexagon, Cpu, ShoppingCart, Sparkles, Trophy } from 'lucide-react';
import { auth } from '@/lib/auth';
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

const FEATURES = [
  {
    Icon: Cpu,
    title: 'Race Engine',
    description:
      'Automated 1v1 drone races every 3 minutes. ELO matchmaking keeps it competitive.',
  },
  {
    Icon: ShoppingCart,
    title: 'Marketplace',
    description:
      'Buy and sell drones, skins, and mods. 5% platform rake. Real player economy.',
  },
  {
    Icon: Sparkles,
    title: 'Skins & Mods',
    description:
      'Legendary skins replace your drone entirely. Mods add strategic stat tradeoffs.',
  },
  {
    Icon: Trophy,
    title: 'Compete',
    description:
      'Climb the ELO leaderboard. Manage up to 3 active drones across 4 tiers.',
  },
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
          className={styles.heroVideo}
          aria-hidden="true"
        >
          <source src="/hero-video.mp4" type="video/mp4" />
        </video>
        <div className={styles.heroOverlay} aria-hidden="true" />
        <div className={styles.heroContent}>
          <Hexagon
            size={48}
            strokeWidth={1.5}
            className={styles.heroHex}
            aria-hidden="true"
          />
          <h1 className={styles.heroTitle}>HYPERDROME</h1>
          <p className={styles.heroSubtitle}>
            Drone racing strategy game. Level your drones, grow your fleet,
            strategize your mods, collect your skins.
          </p>
          <p className={styles.heroTiming}>
            Races every 3 minutes. 2 minutes to prepare.
          </p>
          <HeroActions />
        </div>
      </section>

      <section className={styles.featuresSection} aria-label="Features">
        <div className={styles.featuresGrid}>
          {FEATURES.map(({ Icon, title, description }) => (
            <article key={title} className={styles.featureCard}>
              <Icon
                size={32}
                strokeWidth={1.5}
                className={styles.featureIcon}
                aria-hidden="true"
              />
              <h2 className={styles.featureTitle}>{title}</h2>
              <p className={styles.featureDescription}>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>Dendrite Games © 2026</footer>
    </div>
  );
}
