'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import styles from './page.module.css';

const FAQ_SECTIONS = [
  {
    category: 'General',
    items: [
      {
        q: 'What is Drone Manager?',
        a: 'Passive competitive drone racing. You own drones, allocate stats, and they race automatically every 5 minutes. A weighted simulator decides the winner. Wins pay volts and XP. See the Game Guide for the full breakdown.',
      },
      {
        q: 'Is it free to play?',
        a: 'Yes. Sign up and you get a free Level 1 starter drone. All progression is earned by racing.',
      },
      {
        q: 'Do I need to be online for races?',
        a: 'No. The race cycle runs every 5 minutes whether you\'re logged in or not. Results land in your race log.',
      },
      {
        q: 'How often do races happen?',
        a: 'Every 5 minutes (300 seconds). The countdown to the next cycle is on the dashboard.',
      },
      {
        q: 'How do I sign up?',
        a: 'Go to /login, enter your email, click the magic link we send you. No password.',
      },
      {
        q: 'What\'s the max level?',
        a: '20. Past Level 20 the XP bar pins to full and stops counting toward level. ELO, season volts, and skin progression keep going.',
      },
      {
        q: 'How is the season timer counted?',
        a: 'Seasons run 30 days from the start date set on the active season row. End time is the same time of day, 30 days later.',
      },
    ],
  },

  {
    category: 'Drones',
    items: [
      {
        q: 'How do I get more drones?',
        a: 'Buy them on the marketplace from other players. There\'s no other way to acquire additional drones today.',
      },
      {
        q: 'Can I have multiple active drones?',
        a: 'Yes, up to 3 once you unlock the slots. Slot 2 unlocks at 500 total races. Slot 3 unlocks at 2,000 total races. Total races counts every race any of your drones runs.',
      },
      {
        q: 'What happens when my drone levels up?',
        a: '+20 to its Total Stat Budget. Per-stat cap rises by 4 or 5. +20 volts pay into your wallet. At levels 6, 11, and 16 the drone crosses a tier boundary and its appearance changes.',
      },
      {
        q: 'Can I reset my drone\'s stats?',
        a: 'No. Stat allocations are permanent. Plan before you spend.',
      },
      {
        q: 'What does Total Volts Invested mean?',
        a: 'The lifetime sum of volts spent upgrading that drone\'s stats. It\'s a value indicator on the marketplace. It doesn\'t affect race math.',
      },
      {
        q: 'Do all my drones share XP?',
        a: 'No. XP belongs to the drone that ran the race. Only that drone gains XP and is eligible to level up from it.',
      },
      {
        q: 'Can I deactivate a drone?',
        a: 'Yes. Toggle it off from its detail page. An inactive drone doesn\'t race and doesn\'t earn XP or volts.',
      },
      {
        q: 'What if I have more drones than active slots?',
        a: 'Only the ones marked active race each cycle. The rest sit in inventory. Activate / deactivate freely as long as the active count stays at or below your slot count.',
      },
      {
        q: 'Can I rename my drone?',
        a: 'Not today. Drone names are set at creation (or by the previous owner before sale).',
      },
      {
        q: 'What do I start with?',
        a: 'A Level 1 drone with all 9 stats at 1, TSB 29, ELO 1000, active. Wallet 0 volts. 1 active drone slot.',
      },
    ],
  },

  {
    category: 'Stats',
    items: [
      {
        q: 'What\'s the difference between Speed and Acceleration?',
        a: 'Speed weights 40% on straights, 0% on turns. Acceleration weights 30% on straights and 20% on turns. Speed is a pure straight-line bonus. Acceleration helps everywhere.',
      },
      {
        q: 'Does Consistency do anything besides reduce variance?',
        a: 'Yes. It also weights 15% on every segment, both straights and turns. So it adds a steady contribution to score on top of dampening randomness.',
      },
      {
        q: 'Does Wind Resistance only matter when it\'s windy?',
        a: 'No. Wind Resistance weights 15% on every straight regardless of weather. In "wind" weather it additionally applies a multiplier to every segment score.',
      },
      {
        q: 'Why isn\'t my Night Vision helping?',
        a: 'It only applies when the race rolls "night" time of day. Dawn, day, and dusk leave it inactive.',
      },
      {
        q: 'How do the weather multipliers scale?',
        a: 'Rain Handling, Wind Resistance (in wind), and Night Vision (at night) all scale the same way. At stat 0 the multiplier is 0.5x. At 50 it\'s 1.0x (neutral). At 75+ it caps at 1.5x. The multiplier hits every segment score for the whole race.',
      },
      {
        q: 'Should I focus one stat or spread evenly?',
        a: 'Both work. A specialist (e.g. 70 turning, low everything else) wins on turn-heavy tracks and dies on straight-heavy ones. A balanced build wins less hard but loses less hard. Per-stat caps slow extreme specialization at low level.',
      },
      {
        q: 'Does Battery Capacity matter on short tracks?',
        a: 'Less. Short tracks apply a 0.8x length multiplier to battery drain. Long tracks apply 1.2x. Across 3 laps on a long track, 0 battery can lose up to 60% of segment score by lap 3. On a short track, the same drone loses about 40%.',
      },
      {
        q: 'What\'s the per-stat cap at each level?',
        a: 'cap = min(100, 10 + floor(4.5 * level)). L1: 14. L5: 32. L10: 55. L15: 77. L20: 100.',
      },
      {
        q: 'How much does it cost to fully max a stat?',
        a: '460 volts to raise one stat from 1 to 100. Costs are 1 per upgrade in the 1-9 band, 2 in 10-19, 3 in 20-29, all the way to 10 per upgrade in 90-99.',
      },
      {
        q: 'What\'s TSB?',
        a: 'Total Stat Budget. The maximum sum of your 9 stats. Formula: 9 + 20 * level. L1: 29. L20: 409.',
      },
    ],
  },

  {
    category: 'Racing',
    items: [
      {
        q: 'How is the winner decided?',
        a: 'Each track is a fixed list of straights and turns shuffled into a segment order. For each segment, both drones get a score from a weighted stat formula, modified by weather, time of day, battery degradation, and a small consistency-dampened variance. Score becomes time via 100 / score. Times accumulate over 3 laps. Lower total time wins.',
      },
      {
        q: 'What stats matter most?',
        a: 'Depends on the track and conditions. Speed dominates straight-heavy tracks. Turning dominates turn-heavy tracks. Consistency adds steady score and reduces randomness. Battery Capacity matters on long tracks and later laps. Weather stats matter when the conditions roll.',
      },
      {
        q: 'Can I choose which track to race on?',
        a: 'No. Tracks are randomly picked from the pool whose level range covers your bracket.',
      },
      {
        q: 'What is an UPSET?',
        a: 'A win by a lower-rated drone over a higher-rated one. The race is flagged UPSET in the log. The winner gets a volts bonus = floor((loserElo - winnerElo) / 100).',
      },
      {
        q: 'Why did my drone race a bot?',
        a: 'When a bracket has fewer than 4 active drones (or an odd count), the system backfills with bots up to an even number at minimum 4. This guarantees every active drone races every cycle.',
      },
      {
        q: 'How many laps per race?',
        a: '3 laps. Same shuffled segment order each lap.',
      },
      {
        q: 'What weather conditions roll?',
        a: 'Clear, clouds, rain, heavy rain, wind, haze, fog. 7 options. Equal random pick each race.',
      },
      {
        q: 'What times of day roll?',
        a: 'Dawn, day, dusk, night. 4 options. Equal random pick each race.',
      },
      {
        q: 'Can a race tie?',
        a: 'No. If the totals come out equal (very rare with floating-point times), the simulator awards the win to drone 1 by default. In practice variance keeps ties from happening.',
      },
      {
        q: 'Where do I see how my drone performed?',
        a: 'Race detail view. Every segment shows both drones\' scores and times. The full segment log makes it visible where you gained or lost time.',
      },
      {
        q: 'Why did I lose to a lower-stat drone?',
        a: 'Three usual culprits. Variance (consistency-dampened randomness) rolled their way. Weather hit your weak stat (e.g. heavy rain on a low rain-handling drone). Battery degradation on later laps stacked against you.',
      },
      {
        q: 'How are races assigned?',
        a: 'Races run in automated batches. When a batch triggers, the system pairs active drones within level brackets (1-5, 6-10, 11-15, 16-20) based on ELO rating. If your drone is active, it races every batch.',
      },
      {
        q: 'What is the strategy window?',
        a: 'After matchmaking, races enter a three-minute pending state. You can see your opponent, the track, and conditions. In Season 2, this is where you\'ll swap Mods to adapt. For now, use it to study your matchups and learn opponent patterns.',
      },
      {
        q: 'What happens if I deactivate a drone between races?',
        a: 'The change takes effect after the current race batch resolves. You cannot pull a drone out of a pending race.',
      },
    ],
  },

  {
    category: 'Volts',
    items: [
      {
        q: 'How do I earn volts?',
        a: 'Win races. Sell on the marketplace. Get the +20 wallet bonus on every level-up.',
      },
      {
        q: 'Do losers earn volts?',
        a: 'No. Losers earn 4 XP only. Winner takes the volts.',
      },
      {
        q: 'How much do I earn per win?',
        a: 'Base 3 + floor(track difficulty / 2) + max(0, floor((loserElo - winnerElo) / 100)). Range: 3 volts (difficulty-1, even matchup) up to 12+ on a hard track with a big upset.',
      },
      {
        q: 'Are volts shared between my drones?',
        a: 'Yes. One wallet per player. Spend it where you want, on any drone.',
      },
      {
        q: 'What can I spend volts on?',
        a: 'Stat upgrades, marketplace listings (drones and unbound skins), and packs (Starter 500, Premium 2,000, Legendary 10,000).',
      },
    ],
  },

  {
    category: 'ELO',
    items: [
      {
        q: 'What\'s my starting ELO?',
        a: '1000 for both drones and players.',
      },
      {
        q: 'How is ELO calculated?',
        a: 'Standard ELO with K-factor 32. Expected score from rating diff, K * (actual - expected) gets added to the winner and subtracted from the loser. Same-rated win swings +/- 16. 200 ELO underdog win swings around +/- 24. 200 ELO favorite win swings around +/- 8.',
      },
      {
        q: 'Why did I lose 20 ELO from one race?',
        a: 'You lost to a drone rated below you. Expected loss is small, actual loss is 0, so the K-factor delta lands closer to the full -16/-20 range.',
      },
      {
        q: 'Does selling a drone reset its ELO?',
        a: 'No. ELO is tied to the drone, so it carries over to the new owner. Player ELO is separate and tracks the player\'s race history.',
      },
    ],
  },

  {
    category: 'Marketplace',
    items: [
      {
        q: 'How do I sell a drone?',
        a: 'Marketplace > List Item > Drone > pick the drone > set a price > confirm.',
      },
      {
        q: 'Can I sell an active drone?',
        a: 'Yes. Listing doesn\'t deactivate the drone. It keeps racing until someone buys it.',
      },
      {
        q: 'What\'s the marketplace fee?',
        a: '5% of the sale price goes to the platform. Seller gets 95%.',
      },
      {
        q: 'What\'s the minimum listing price?',
        a: '10 volts.',
      },
      {
        q: 'Can I cancel a listing?',
        a: 'Yes. Cancel anytime before it sells. The drone or skin returns to your inventory.',
      },
      {
        q: 'What transfers when I buy a drone?',
        a: 'Level, XP, the full stat sheet, ELO, race history, and any applied skins. The drone keeps its identity. You become the new owner.',
      },
      {
        q: 'Can I sell a skin separately?',
        a: 'Only if the skin hasn\'t been applied to a drone. Once applied, a skin is bound to that drone and transfers with it.',
      },
      {
        q: 'Can I list multiple items at once?',
        a: 'Yes. Each listing is independent.',
      },
    ],
  },

  {
    category: 'Economy',
    items: [
      {
        q: 'How do I earn volts?',
        a: 'By racing. Winners earn more than losers. You can also purchase Volt Chests with $TOKEN when the token economy goes live in Season 2.',
      },
      {
        q: 'Can I make real money playing?',
        a: 'You can build drones and sell them on the Marketplace. A well-built drone with smart stats, good skins, and eventually mods is worth more than a base drone. Your time and skill translate to asset value. The volts-to-token cashout coming in Season 2 will provide a direct exit path with conversion controls.',
      },
      {
        q: 'Is this pay-to-win?',
        a: 'No. Buying volts lets you acquire drones faster, but drone power comes from leveling (earned through racing, no shortcut) and stat allocation (strategic decisions with no respec). A well-built cheap drone beats a badly-built expensive one.',
      },
      {
        q: 'What is the 5% marketplace rake?',
        a: 'Every sale on the Marketplace has a 5% fee deducted from the sale price. This is the protocol\'s revenue and helps control volt supply in the economy.',
      },
    ],
  },

  {
    category: 'Skins and Packs',
    items: [
      {
        q: 'What do skins do?',
        a: 'Cosmetic only. Zero effect on race math.',
      },
      {
        q: 'Can I remove or swap a skin?',
        a: 'No. Skin application is permanent. Once applied, it\'s bound to the drone forever.',
      },
      {
        q: 'How many skins exist?',
        a: '56 in the vault: 30 commons, 15 rares, 8 epics, 3 legendaries. Legendaries are unique one-of-ones.',
      },
      {
        q: 'Can two players own the same skin?',
        a: 'No. Each skin is a single instance. When a player owns it, no one else can. Sell or apply changes ownership.',
      },
      {
        q: 'What\'s in the Starter Pack (500 volts)?',
        a: '3 skins. Slot 1: Common. Slot 2: Common. Slot 3: Rare 70% / Epic 25% / Legendary 5%.',
      },
      {
        q: 'What\'s in the Premium Pack (2,000 volts)?',
        a: '3 skins. Slot 1: Rare. Slot 2: Epic 60% / Legendary 40%. Slot 3: Common 40% / Rare 35% / Epic 20% / Legendary 5%.',
      },
      {
        q: 'What\'s in the Legendary Pack (10,000 volts)?',
        a: '3 skins. Slot 1: Epic. Slot 2: Legendary. Slot 3: Rare 30% / Epic 50% / Legendary 20%.',
      },
      {
        q: 'Are skins pay-to-win?',
        a: 'No. Skins have zero effect on race outcomes. Stats decide races.',
      },
      {
        q: 'Do skins drop in races?',
        a: 'Yes. Per-race chance: 5% common, 2% rare, 0.5% epic, 0.1% legendary. Drops land unbound in your inventory.',
      },
      {
        q: 'What if a pack rolls a rarity that\'s sold out?',
        a: 'The open is rejected before your wallet is charged. Try again later when more skins become available in the vault.',
      },
      {
        q: 'How do tier-aware skins handle a level-up?',
        a: 'Common, Rare, and Epic skins re-apply on the new tier silhouette when the drone hits a new tier. The color scheme follows you up. Legendary skins replace the silhouette outright and don\'t change with tier.',
      },
    ],
  },

  {
    category: 'Seasons',
    items: [
      {
        q: 'How long is a season?',
        a: '30 days.',
      },
      {
        q: 'What resets at season-end?',
        a: 'Season volts and the leaderboard. New season starts at 0 for everyone.',
      },
      {
        q: 'What carries over?',
        a: 'Drone level, XP, stats, ELO, your wallet, owned drones, owned skins, and active drone slots. All permanent.',
      },
      {
        q: 'What are season rewards?',
        a: 'Top finishers earn rewards distributed at the season cutover.',
      },
    ],
  },

  {
    category: 'Season 2',
    items: [
      {
        q: 'What are Mods?',
        a: 'Equippable drone modifications coming in Season 2 that affect race performance. Each Mod boosts one stat at the cost of another. They bind permanently to a drone but can be swapped freely within that drone\'s collection between races.',
      },
      {
        q: 'What is the pre-race strategy window used for in Season 2?',
        a: 'During the three-minute pending window, you\'ll be able to swap equipped Mods on your drone based on the opponent matchup and track conditions. This is where build strategy happens. Adapt your loadout to counter opponents and optimize for specific tracks.',
      },
      {
        q: 'Will there be a token?',
        a: 'Season 2 introduces the tokenized economy on MegaETH. Volts maintain a stable USD value. $TOKEN is used to purchase Volt Chests and as the settlement currency when the Marketplace moves on-chain. Specific token details will be announced in collaboration with the MegaETH team.',
      },
    ],
  },
];

export default function FaqPage() {
  const [openKey, setOpenKey] = useState(null);

  const toggle = (key) => {
    setOpenKey((curr) => (curr === key ? null : key));
  };

  return (
    <NavShell>
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>FAQ</h1>
          <p className={styles.pageSubtitle}>
            Quick answers. For mechanics in depth, see the{' '}
            <a href="/guide" className={styles.headerLink}>
              Game Guide
            </a>
            .
          </p>
        </header>

        <div className={styles.categories}>
          {FAQ_SECTIONS.map((section, sIdx) => (
            <Card key={section.category} className={styles.categoryCard}>
              <h2 className={styles.sectionHeading}>{section.category}</h2>
              <ul className={styles.rowList}>
                {section.items.map((item, iIdx) => {
                  const key = `${sIdx}-${iIdx}`;
                  const open = openKey === key;
                  const panelId = `faq-panel-${key}`;
                  const buttonId = `faq-btn-${key}`;
                  return (
                    <li key={key} className={styles.row}>
                      <button
                        type="button"
                        id={buttonId}
                        className={styles.question}
                        aria-expanded={open}
                        aria-controls={panelId}
                        onClick={() => toggle(key)}
                      >
                        <span className={styles.questionText}>{item.q}</span>
                        <ChevronDown
                          size={14}
                          className={cn(
                            styles.chevron,
                            open && styles.chevronOpen,
                          )}
                          aria-hidden="true"
                        />
                      </button>
                      <div
                        id={panelId}
                        role="region"
                        aria-labelledby={buttonId}
                        className={cn(styles.panel, open && styles.panelOpen)}
                      >
                        <div className={styles.panelInner}>
                          <p className={styles.answer}>{item.a}</p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      </div>
    </NavShell>
  );
}
