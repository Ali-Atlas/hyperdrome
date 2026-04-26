import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Wrench,
  Zap,
  TrendingUp,
  Target,
  Settings2,
  Trophy,
  Store,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import { auth } from '@/lib/auth';
import ScrollReveal from '@/components/util/ScrollReveal';
import VoltIcon from '@/components/ui/VoltIcon';
import styles from './page.module.css';

export const metadata = {
  title: 'Hyperdrome - Competitive Idle Drone Racing',
  description:
    'Build, optimize, and dominate the circuit. Own drones, allocate stats, and race automatically every 2 minutes. Earn volts, trade skins, climb the leaderboard.',
  openGraph: {
    title: 'Hyperdrome - Competitive Idle Drone Racing',
    description:
      'Build, optimize, and dominate the circuit. Own drones, allocate stats, and race automatically every 2 minutes.',
    type: 'website',
  },
};

const HOW_STEPS = [
  {
    num: '01',
    title: 'Build Your Drone.',
    description: 'Optimize performance stats to dominate the competition.',
    Icon: Wrench,
  },
  {
    num: '02',
    title: 'Race Automatically.',
    description: 'Enter your drone into automated, passive racing cycles.',
    Icon: Zap,
  },
  {
    num: '03',
    title: 'Earn & Trade.',
    description: 'Collect rewards and trade assets on the open marketplace.',
    Icon: TrendingUp,
  },
];

const STATS = [
  { label: 'Total Races Run', value: '1.2M+' },
  { label: 'Active Players', value: '45,000+' },
  { label: 'Total Rewards Distributed', value: '3.5M', isVolts: true },
];

const FEATURES = [
  {
    title: 'Skill-Based Racing',
    description:
      'Develop optimal strategies based on track data and competition.',
    Icon: Target,
  },
  {
    title: 'Drone Customization',
    description:
      'Upgrade components to enhance speed, agility, and endurance.',
    Icon: Settings2,
  },
  {
    title: 'Leaderboards & Seasons',
    description:
      'Compete for top rankings and exclusive seasonal rewards.',
    Icon: Trophy,
  },
  {
    title: 'Marketplace',
    description: 'Trade drones and custom skins on the open marketplace.',
    Icon: Store,
  },
  {
    title: 'On-Chain Ownership',
    description:
      'True ownership of all in-game assets, verifiable on the blockchain.',
    Icon: ShieldCheck,
  },
];

export default async function LandingPage() {
  // Logged-in users never see the marketing page - bounce straight to dashboard.
  const session = await auth();
  if (session?.user) {
    redirect('/dashboard');
  }

  return (
    <div className={styles.page}>
      {/* ---- Nav ---- */}
      <nav className={styles.nav} aria-label="Primary">
        <Link href="/" className={styles.logo}>
          <span className={styles.logoMark} aria-hidden="true">
            ◢
          </span>
          Hyperdrome
        </Link>
        <ul className={styles.navLinks}>
          <li>
            <a href="#how-it-works">How It Works</a>
          </li>
          <li>
            <a href="#features">Features</a>
          </li>
          <li>
            <a href="#docs">Docs</a>
          </li>
          <li>
            <a href="#community">Community</a>
          </li>
        </ul>
        <Link href="/login" className={styles.navCta}>
          Start Racing
        </Link>
      </nav>

      <main>
        {/* ---- Hero ---- */}
        <section className={styles.hero}>
          <div className={styles.heroImageWrap} aria-hidden="true">
            <HeroDrone />
          </div>
          <h1 className={styles.heroHeading}>
            Build, Optimize, and
            <br />
            Dominate the Circuit
          </h1>
          <div className={styles.heroCtas}>
            <Link href="/login" className={styles.primaryBtn}>
              Start Racing
            </Link>
            <a href="#how-it-works" className={styles.secondaryBtn}>
              Learn More
            </a>
          </div>
        </section>

        {/* ---- How It Works ---- */}
        <ScrollReveal as="section" className={`${styles.section}`}>
          <div id="how-it-works">
            <h2 className={styles.sectionHeading}>How It Works</h2>
            <div className={styles.steps}>
              {HOW_STEPS.map(({ num, title, description, Icon }, idx) => (
                <div key={num} className={styles.stepWrap}>
                  <article className={styles.step}>
                    <div className={styles.stepLabel}>Step {num}</div>
                    <h3 className={styles.stepTitle}>{title}</h3>
                    <div className={styles.stepIcon}>
                      <Icon size={48} strokeWidth={1.5} />
                    </div>
                    <p className={styles.stepDescription}>{description}</p>
                  </article>
                  {idx < HOW_STEPS.length - 1 && (
                    <ArrowRight
                      className={styles.stepArrow}
                      size={28}
                      aria-hidden="true"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </ScrollReveal>

        {/* ---- Stats ticker ---- */}
        <ScrollReveal as="section" className={styles.statsBar}>
          {STATS.map(({ label, value, isVolts }) => (
            <div key={label} className={styles.stat}>
              <div className={styles.statValue}>
                {isVolts && <VoltIcon size={20} />}
                {value}
              </div>
              <div className={styles.statLabel}>{label}</div>
            </div>
          ))}
        </ScrollReveal>

        {/* ---- Features ---- */}
        <ScrollReveal as="section" className={styles.section}>
          <div id="features">
            <h2 className={styles.sectionHeading}>Features</h2>
            <div className={styles.features}>
              {FEATURES.map(({ title, description, Icon }, idx) => (
                <article
                  key={title}
                  className={styles.featureCard}
                  style={{ animationDelay: `${idx * 80}ms` }}
                >
                  <Icon size={32} strokeWidth={1.5} className={styles.featureIcon} />
                  <h3 className={styles.featureTitle}>{title}</h3>
                  <p className={styles.featureDescription}>{description}</p>
                </article>
              ))}
            </div>
          </div>
        </ScrollReveal>
      </main>

      {/* ---- Footer ---- */}
      <footer className={styles.footer}>
        <div className={styles.footerLogo}>
          <span className={styles.logoMark} aria-hidden="true">
            ◢
          </span>
          Hyperdrome
        </div>
        <ul className={styles.footerLinks}>
          <li>
            <a href="#terms">Terms of Service</a>
          </li>
          <li>
            <a href="#privacy">Privacy Policy</a>
          </li>
          <li>
            <a href="#community">Community</a>
          </li>
        </ul>
      </footer>
    </div>
  );
}

/** Simple wireframe drone hero graphic, rendered inline so we don't need an asset. */
function HeroDrone() {
  return (
    <svg
      viewBox="0 0 600 260"
      xmlns="http://www.w3.org/2000/svg"
      className={styles.heroSvg}
      role="img"
      aria-label="Stylised racing drone"
    >
      <defs>
        <linearGradient id="bodyGrad" x1="0" x2="1">
          <stop offset="0" stopColor="#03DAC6" stopOpacity="0.2" />
          <stop offset="1" stopColor="#03DAC6" stopOpacity="0.8" />
        </linearGradient>
      </defs>

      {/* Rotor arms */}
      <g stroke="#03DAC6" strokeWidth="1.5" fill="none" opacity="0.9">
        <line x1="120" y1="80" x2="220" y2="140" />
        <line x1="120" y1="200" x2="220" y2="140" />
        <line x1="480" y1="80" x2="380" y2="140" />
        <line x1="480" y1="200" x2="380" y2="140" />
      </g>

      {/* Body outline */}
      <g stroke="#03DAC6" strokeWidth="2" fill="none">
        <polygon
          points="220,140 300,90 380,140 300,190"
          fill="url(#bodyGrad)"
        />
        <polygon points="220,140 300,120 380,140 300,160" opacity="0.6" />
      </g>

      {/* Rotor circles */}
      <g stroke="#03DAC6" strokeWidth="1.5" fill="none" opacity="0.6">
        <circle cx="120" cy="80" r="26" />
        <circle cx="120" cy="200" r="26" />
        <circle cx="480" cy="80" r="26" />
        <circle cx="480" cy="200" r="26" />
      </g>

      {/* Lights */}
      <circle cx="300" cy="90" r="3" fill="#03DAC6" />
      <circle cx="300" cy="190" r="3" fill="#03DAC6" />

      {/* Ground reflection */}
      <line
        x1="180"
        y1="230"
        x2="420"
        y2="230"
        stroke="#03DAC6"
        strokeWidth="1"
        opacity="0.3"
      />
    </svg>
  );
}
