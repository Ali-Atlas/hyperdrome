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
        q: 'What is Hyperdrome?',
        a: 'Passive competitive drone racing. You own drones, allocate stats, and they race automatically every 3 minutes. A weighted simulator decides the winner. Wins pay volts and XP. See the Game Guide for the full breakdown.',
      },
      {
        q: 'Is it free to play?',
        a: 'Yes. Connect a wallet and you get a free Level 1 starter drone (active by default, minted to your wallet as an NFT), 1000 VOLT minted on-chain, and 1 active drone slot at ELO 1000. All further progression is earned by racing. Or pick Play Demo for a pre-seeded off-chain account if you want to look around first.',
      },
      {
        q: 'Do I need to be online for races?',
        a: 'No. The race cycle runs every 3 minutes whether you\'re logged in or not. Results land in your race log.',
      },
      {
        q: 'How often do races happen?',
        a: 'Every 3 minutes (180 seconds). The countdown to the next cycle is on the dashboard.',
      },
      {
        q: 'How do I sign up?',
        a: 'Click Connect Wallet on the landing page and pick a wallet (MetaMask or any injected browser wallet). The first time you connect from a new address, the server provisions your starter drone NFT and 1000 VOLT and signs you in. Returning visitors connect once and land back in the dashboard.',
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
        a: 'Three ways. (1) Race milestones: at 1,000 total races (across all your drones) you auto-receive a free Level 1 drone, plus a slot 2 unlock. At 3,000 races, the same again with slot 3. Each milestone spawn includes one unbound common skin and one unbound common mod. (2) NPC vendor: 3,500 volts per Level 1 drone. Random mid-range stats, one bound common skin, one bound common mod. Available anytime, no marketplace dependency. (3) Marketplace: buy a drone listed by another player at any level with whatever skins, mods, and race history the seller built into it.',
      },
      {
        q: 'Can I buy XP or buy levels?',
        a: 'No. Leveling is gated behind racing. 10 XP per win, 4 per loss. Buying volts speeds up stat allocation on a drone you already own, but it doesn\'t skip progression.',
      },
      {
        q: 'Can I have multiple active drones?',
        a: 'Yes, up to 3 once you unlock the slots. Slot 2 unlocks at 1,000 total races. Slot 3 unlocks at 3,000 total races. Total races counts every race any of your drones runs. Each unlock also auto-spawns a free Level 1 drone (with an unbound common skin and mod) so the new slot has a drone to fill it.',
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
        q: 'How does activating and deactivating drones work?',
        a: 'Toggle the active flag from a drone\'s detail page. The change goes through a one-cycle pending state. Switching on shows the drone as Activating and starts racing it at the next 3-minute cycle. Switching off shows it as Deactivating: the drone races out the current matchup, then drops out of matchmaking starting next cycle. Click the toggle a second time while it\'s still pending to cancel and return to the original state. The strategy lock window does not block these toggles. Only mod and skin swaps lock during that period.',
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
        a: 'A Level 1 drone (active, ELO 1000, all 9 stats randomized in a low range and trimmed to fit the Level 1 stat budget), 500 volts in your wallet, one unbound common skin, one unbound common mod, and 1 active drone slot.',
      },
    ],
  },

  {
    category: 'Stats',
    items: [
      {
        q: 'What\'s the difference between Speed and Acceleration?',
        a: 'Speed is dominant on straights, especially long ones. Acceleration helps on every segment type - the universal contributor.',
      },
      {
        q: 'Does Consistency do anything besides reduce variance?',
        a: 'No. Consistency is a pure variance dampener. It does not contribute to segment scoring. At consistency 0 there is a meaningful per-segment time variance. As consistency rises, variance shrinks toward zero. Higher consistency means more predictable race results.',
      },
      {
        q: 'Does Wind Resistance only matter when it\'s windy?',
        a: 'No. Wind Resistance contributes on every straight regardless of weather. In wind conditions, it becomes a major factor on all segments.',
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
        a: 'Less. Short tracks barely touch battery. Long tracks punish battery more. Across 3 laps on a long track, 0 battery loses heavy performance by lap 3. On a short track, the same drone loses moderate performance.',
      },
      {
        q: 'What\'s the per-stat cap at each level?',
        a: 'Per-stat caps rise with each level. Low-level drones can\'t dump everything into one stat. By level 20, any stat can reach 100.',
      },
      {
        q: 'How much does it cost to fully max a stat?',
        a: 'Fully maxing a stat costs hundreds of volts. Early upgrades are cheap. Late ones add up.',
      },
      {
        q: 'What\'s TSB?',
        a: 'Total Stat Budget. The maximum sum of your 9 stats. Your total stat budget grows by 20 points per level. Check your drone\'s detail page for your current budget and cap.',
      },
    ],
  },

  {
    category: 'Racing',
    items: [
      {
        q: 'How is the winner decided?',
        a: 'Each track is a fixed count of straights and turns, clustered into stretches of 2-4 same-type segments and re-shuffled at the start of every lap. For each segment, both drones get a score from a weighted stat formula, modified by weather, time of day, battery degradation, and a small consistency-dampened variance. Higher stats produce faster segment times. Track difficulty sets the baseline pace - harder tracks have longer base segment times. Times accumulate over 3 laps. Lower total time wins.',
      },
      {
        q: 'What stats matter most?',
        a: 'Depends on the track and conditions. Speed dominates straight-heavy tracks. Turning dominates turn-heavy tracks. Consistency reduces randomness. Battery Capacity matters on long tracks and later laps. Weather stats matter when the conditions roll.',
      },
      {
        q: 'Can I choose which track to race on?',
        a: 'No. Tracks are randomly picked from the pool whose level range covers your bracket.',
      },
      {
        q: 'What is an UPSET?',
        a: 'A win by a lower-rated drone over a higher-rated one. The race is flagged UPSET in the log. The winner gets a volts bonus. The bigger the ELO gap you overcome, the bigger the upset bonus.',
      },
      {
        q: 'Why did my drone race a bot?',
        a: 'When a bracket has fewer than 4 active drones (or an odd count), the system backfills with bots up to an even number at minimum 4. This guarantees every active drone races every cycle.',
      },
      {
        q: 'How many laps per race?',
        a: '3 laps. Segments are re-shuffled at the start of every lap, so the layout varies lap to lap.',
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
        a: 'No. If the totals come out equal (very rare with floating-point times), the simulator breaks the tie with a coin flip. In practice variance keeps ties from happening.',
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
        a: 'After matchmaking, races enter a two-minute pending state. You see your opponent, the track, and the rolled conditions. This is the window where you swap the equipped mod on your drone to adapt to the matchup before the race executes.',
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
        a: 'Race. Winners earn volts based on their level, track difficulty, whether it was an upset, and how dominant the win was. Losers always earn volts; the payout scales with level so high-level losses still feel worthwhile. Also: marketplace sales (90% of sale price), and a +20 wallet bonus on every level-up.',
      },
      {
        q: 'Do losers earn volts?',
        a: 'Yes. Losers always earn volts. The payout scales with level so high-level losses still feel worthwhile. Plus 4 XP every loss.',
      },
      {
        q: 'How much does a win pay?',
        a: 'Winners earn volts based on their level, track difficulty, whether it was an upset, and how dominant the win was. Higher-level wins on harder tracks pay significantly more.',
      },
      {
        q: 'How does the payout system work?',
        a: 'Wins are tiered. Level, track difficulty, upsets (beating higher-rated opponents), and dominant wins all add bonuses on top of the base payout. Losses also pay - the loser payout scales with level. The intent is that losing a tight race at high level still earns meaningful volts, while crushing wins on hard tracks against higher-ranked opponents pay out big.',
      },
      {
        q: 'Are volts shared between my drones?',
        a: 'Yes. One wallet per player. Spend it where you want, on any drone.',
      },
      {
        q: 'What can I spend volts on?',
        a: 'Stat upgrades, marketplace listings (drones, unbound skins, unbound mods), skin packs (Starter 2,000 / Premium 12,000 / Legendary 60,000) and mod capsules (Starter 1,000 / Premium 6,000 / Legendary 30,000) - 3 items per pack on either line.',
      },
      {
        q: 'Can I buy XP?',
        a: 'No. Volts buy stat allocation; XP only comes from racing. There\'s no shortcut to leveling up.',
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
        a: 'Standard ELO rating system. Beating higher-rated opponents moves your rating more. Beating lower-rated opponents moves it less. Upsets swing big.',
      },
      {
        q: 'Why did I lose 20 ELO from one race?',
        a: 'You lost to a lower-rated drone. The bigger the rating gap, the more you lose.',
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
        a: '10% of the sale price goes to the platform. Seller gets 90%.',
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
        a: 'Only unbound skins (ones you own but haven\'t bound to a drone). Once a skin is bound to a drone, it can only be sold as part of the drone itself.',
      },
      {
        q: 'Can I sell a mod separately?',
        a: 'Same rule as skins. Unbound mods can be listed standalone. Bound mods transfer with the drone they\'re bound to.',
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
        a: 'By racing. Winners earn volts based on their level, track difficulty, whether it was an upset, and how dominant the win was. Losers always earn volts; the payout scales with level. Plus level-up bonuses (+20 volts each level) and marketplace sales (90% of price after the 10% rake).',
      },
      {
        q: 'Is this pay-to-win?',
        a: 'No. Buying volts speeds up stat allocation on a drone you already own, but it doesn\'t buy XP, levels, or wins. Levels come only from racing. A well-built cheap drone beats a badly-built expensive one.',
      },
      {
        q: 'What is the marketplace rake?',
        a: 'Every sale on the Marketplace has a 10% fee deducted from the sale price. This is the platform\'s only fee and helps control volt supply in the economy.',
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
        q: 'Can I swap which skin my drone is wearing?',
        a: 'Yes. Binding adds a skin to a drone\'s collection permanently, but you can swap which bound skin is actively displayed at any time at no cost. A drone can hold any number of bound skins.',
      },
      {
        q: 'Can I unbind a skin or move it to another drone?',
        a: 'No. Bind is permanent. The skin can never leave that drone\'s collection. If the drone is sold on the marketplace, the entire skin collection transfers with it to the buyer.',
      },
      {
        q: 'Are legendary skins unique?',
        a: 'Yes. Legendary skins are one-of-a-kind drone designs - the skin replaces the drone\'s appearance entirely (it IS the drone, visually) and only one player can own a given legendary skin at a time.',
      },
      {
        q: 'How many skins exist?',
        a: '61 in the vault: 30 commons, 15 rares, 8 epics, 8 legendaries. Legendaries are unique one-of-ones.',
      },
      {
        q: 'Can two players own the same skin?',
        a: 'No. Each skin is a single instance. When a player owns it, no one else can. Sell or apply changes ownership.',
      },
      {
        q: 'What\'s in the Starter Pack (2,000 volts)?',
        a: '3 skins. Mostly commons, with a small chance at rares or better.',
      },
      {
        q: 'What\'s in the Premium Pack (12,000 volts)?',
        a: '3 skins. Guaranteed at least one rare. Real chances at epics.',
      },
      {
        q: 'What\'s in the Legendary Pack (60,000 volts)?',
        a: '3 skins. Strong odds at legendaries and epics. The best chance at top-tier items.',
      },
      {
        q: 'Are skins pay-to-win?',
        a: 'No. Skins have zero effect on race outcomes. Stats decide races.',
      },
      {
        q: 'Do skins drop in races?',
        a: 'Yes. Skins drop randomly after races. Commons drop most often. Legendaries are extremely rare. Drops land unbound in your inventory.',
      },
      {
        q: 'What if a pack rolls a rarity that\'s sold out?',
        a: 'The open is rejected before your wallet is charged. Try again later when more items return to the vault.',
      },
      {
        q: 'How do tier-aware skins handle a level-up?',
        a: 'Common, Rare, and Epic skins re-apply on the new tier silhouette when the drone hits a new tier. The color scheme follows you up. Legendary skins replace the silhouette outright and don\'t change with tier.',
      },
      {
        q: 'What\'s in a mod capsule?',
        a: 'Same slot structure as skin packs - 3 mods per capsule, same rarity tables. Mod capsules are priced separately (1,000 / 6,000 / 30,000) and run cheaper than skin packs (2,000 / 12,000 / 60,000). Capsules roll mods instead of skins. Mods are functional (bonus + tradeoff per equip).',
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
    category: 'Mods',
    items: [
      {
        q: 'What are Mods?',
        a: 'Mods are equippable drone modifications. Every mod gives a bonus in one area at the cost of a penalty in another - there are no pure upgrades, only strategic tradeoffs. The bonus and penalty both scale with rarity.',
      },
      {
        q: 'How do Mod rarities differ?',
        a: 'Common gives small safe adjustments. Rare pushes harder with moderate bonuses and penalties. Epic commits to a strategy with strong effects in both directions. Legendary introduces unique mechanics (e.g. ignore lap-1 battery drain, double consistency on turns) with a meaningful stat penalty.',
      },
      {
        q: 'How does Mod binding work?',
        a: 'Same as skins. Binding adds a mod to a drone\'s collection permanently. A drone can hold any number of bound mods. You can swap which mod is actively equipped between races at no cost. The bind itself is permanent: a bound mod can\'t be moved to another drone or sold standalone.',
      },
      {
        q: 'Can I sell Mods on the Marketplace?',
        a: 'Only unbound mods. Once a mod is bound to a drone, it can only be sold as part of the drone itself.',
      },
      {
        q: 'How many Mods can a drone equip at once?',
        a: 'One mod is actively equipped at a time. The drone can have many mods in its bound collection - only the equipped one affects racing. Swap between races to adapt to different matchups.',
      },
      {
        q: 'When do I swap the equipped mod?',
        a: 'During the two-minute strategy window after matchmaking. You see the opponent, the track, and the rolled conditions, then swap the equipped mod on your drone before the race executes.',
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
