'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Rocket,
  Sliders,
  Flag,
  Map,
  TrendingUp,
  Trophy,
  Coins,
  Store,
  Sparkles,
  Package,
  Calendar,
  Zap,
  Timer,
  Wallet,
  ChevronDown,
  Cpu,
} from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import DroneImage from '@/components/ui/DroneImage';
import { cn } from '@/lib/utils';
import styles from './page.module.css';

/**
 * Drone tier showcase data. Tier images are fixed assets in /public/drones/
 * resolved by `DroneImage` via `getDroneImageByLevel(level)`. The level chosen
 * here is just the tier-entry level (1, 6, 11, 16) so the right webp loads.
 */
const DRONE_TIERS = [
  { tier: 1, label: 'Steel', range: '1-5', color: 'steel', level: 1 },
  { tier: 2, label: 'Orange', range: '6-10', color: 'orange', level: 6 },
  { tier: 3, label: 'Purple', range: '11-15', color: 'purple', level: 11 },
  { tier: 4, label: 'Gold', range: '16-20', color: 'gold', level: 16 },
];

const SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    Icon: Rocket,
    blocks: [
      { type: 'subheading', text: 'What is Hyperdrome' },
      {
        type: 'paragraph',
        text: "Passive competitive drone racing. You own drones, allocate stats, and they race automatically every 3 minutes. A weighted simulation decides each race using your stats vs. the opponent's, the track layout, the rolled weather, the time of day, and a small dampened random variance. Every race settles on NEAR testnet. Wins pay volts and XP. Volts spend on stat upgrades, marketplace buys, and packs.",
      },
      { type: 'subheading', text: 'Creating your account' },
      {
        type: 'paragraph',
        text: "Sign in with Google or pick Play Demo on the landing page. The game creates a NEAR testnet account for you and mints your starter kit to it: a free Level 1 drone, an Ember skin, one common mod, and 1,000 volts. You get 1 active drone slot at ELO 1000. The server holds your keys, so you don't need a wallet to play.",
      },
      { type: 'subheading', text: 'Your first drone' },
      {
        type: 'paragraph',
        text: 'Level 1, active by default, with all 9 stats at 1 and 20 points of Total Stat Budget left to allocate. It enters the next race cycle automatically. Every upgrade costs volts, so your 1,000 starting volts fund the first upgrades.',
      },
      { type: 'subheading', text: 'Linking a wallet' },
      {
        type: 'paragraph',
        text: 'Open Wallet and select Connect a wallet. NEAR Connect by HOT lists the testnet wallets that can sign a message. Once a wallet is linked you can withdraw your drones with their bound items, your unbound skins and mods, and your volts to it, up to 40 tokens at a time. After that, only the linked wallet can change the link.',
      },
    ],
  },

  {
    id: 'drone-stats',
    title: 'Drone Stats',
    Icon: Sliders,
    blocks: [
      { type: 'subheading', text: 'The 9 stats' },
      {
        type: 'paragraph',
        text: 'On every track segment (a straight or a turn), each drone gets a score from a weighted combination of stats. A higher score is a faster segment. Higher stats produce faster segment times. Track difficulty sets the baseline pace - harder tracks have longer base segment times. Lowest total time across all segments and laps wins.',
      },
      {
        type: 'list',
        items: [
          { name: 'Speed', desc: 'Dominant on straights, especially long ones.' },
          { name: 'Turning', desc: 'Dominant on turns, especially sharp ones.' },
          { name: 'Acceleration', desc: 'Helps on every segment type. The universal contributor.' },
          {
            name: 'Durability',
            desc: 'Reduces penalties on turns. More important on technical tracks.',
          },
          {
            name: 'Consistency',
            desc: 'No segment-scoring weight. Pure variance dampener. At consistency 0 there is a meaningful per-segment time variance. As consistency rises, variance shrinks toward zero. Higher consistency means more predictable race results.',
          },
          {
            name: 'Battery Capacity',
            desc: 'No direct segment weight. Reduces battery degradation that ramps in later laps. High battery capacity means minimal drain. Zero battery capacity means severe performance loss in later laps, especially on long tracks.',
          },
          {
            name: 'Night Vision',
            desc: 'Triggers at night and as the visibility stat in fog and haze weather. Low night vision gets punished hard at night. High night vision gives a significant edge.',
          },
          {
            name: 'Rain Handling',
            desc: 'Triggers in rain and heavy rain weather. Low rain handling gets punished hard, especially in heavy rain. High rain handling gives a significant edge.',
          },
          {
            name: 'Wind Resistance',
            desc: 'Contributes on every straight regardless of weather. In wind conditions, becomes a major factor on all segments.',
          },
        ],
      },

      { type: 'subheading', text: 'Total Stat Budget (TSB)' },
      {
        type: 'paragraph',
        text: "Your drone's 9 stats can sum to at most TSB. Your total stat budget grows by 20 points per level. Check your drone's detail page for your current budget and cap.",
      },

      { type: 'subheading', text: 'Per-Stat Cap' },
      {
        type: 'paragraph',
        text: "No single stat can exceed the cap for your level. Per-stat caps rise with each level. Low-level drones can't dump everything into one stat. By level 20, any stat can reach 100.",
      },

      { type: 'subheading', text: 'Stat upgrade costs' },
      {
        type: 'paragraph',
        text: "Each point is paid in volts. A point costs 1 + (the stat's current value / 10, rounded down). Low stats are cheap to raise. High stats get expensive. The Stat Editor shows the volts you have left as you add points.",
      },
      {
        type: 'paragraph',
        text: 'Fully maxing a stat costs hundreds of volts. Early upgrades are cheap. Late ones add up.',
      },

      { type: 'subheading', text: 'No respec' },
      {
        type: 'paragraph',
        text: 'Stat allocations are permanent. Once volts are spent on an upgrade, the upgrade is permanent.',
      },
    ],
  },

  {
    id: 'racing',
    title: 'Racing',
    Icon: Flag,
    blocks: [
      { type: 'subheading', text: 'How races work' },
      {
        type: 'paragraph',
        text: 'Every 3 minutes the race cycle runs. All active drones get matched and the matchups are committed on NEAR testnet. The next cycle runs those races and settles them on-chain. Result lands in your race log with the segment-by-segment gaps, the ELO change, the volts payout, the XP, and the race conditions that rolled.',
      },

      { type: 'subheading', text: 'Matchmaking' },
      {
        type: 'paragraph',
        text: 'Drones group into level brackets: 1-5, 6-10, 11-15, 16-20. Inside a bracket, drones sort by ELO and pair with the next-closest rating. Two drones with the same owner never race each other. A bot backfill brings every active bracket up to at least 5 drones, rounded up to even, so active drones have someone to race.',
      },

      { type: 'subheading', text: 'Race simulation' },
      {
        type: 'paragraph',
        text: 'Each track is a fixed count of straights and turns, clustered into stretches of 2-4 same-type segments per lap (e.g. 3 straights, then 2 turns, then 1 straight). Segments are re-shuffled at the start of every lap so the layout varies lap to lap. For each segment, both drones get a score from a weighted stat formula, modified by weather, time of day, battery degradation, and a small consistency-dampened variance. Higher stats produce faster segment times. Track difficulty sets the baseline pace - harder tracks have longer base segment times. Times accumulate. Lower total time wins. The clustering means a stretch of 3 straights gives a speed build a real chance to open a gap before the next turn cluster lets a turning build claw it back.',
      },

      {
        type: 'paragraph',
        text: 'Segments come in multiple subtypes - short bursts, long straights, gentle curves, sharp hairpins, chicanes, and more. Each subtype rewards a different stat mix, so balanced builds have fewer bad matchups while specialists dominate their preferred segments.',
      },

      { type: 'subheading', text: 'Verify a race' },
      {
        type: 'paragraph',
        text: "Open a settled race and press Verify. Your browser reads the race's two transactions from a public NEAR RPC, checks the seed against the committed hash and each drone's stats against the hash the contract accepted, then runs the race again. Each check shows Pass or Fail with a link to its transaction.",
      },
      { type: 'subheading', text: 'AI teams' },
      {
        type: 'paragraph',
        text: 'Four AI teams race alongside players: Vortex Dynamics, Nimbus Racing, Hairpin Collective, and Static Union. Each team owns 3 drones and its own volts, and takes at most one action per cycle. Their spending is capped on-chain at 5,000 volts per transaction and 15,000 per day.',
      },
      { type: 'subheading', text: 'Weather and time of day' },
      {
        type: 'paragraph',
        text: '7 weathers roll randomly per race: clear, clouds, rain, heavy rain, wind, haze, fog. 4 times of day: dawn, day, dusk, night. Clear weather, cloudy weather, dawn, day, and dusk are all neutral. The rest apply stat multipliers:',
      },
      {
        type: 'list',
        items: [
          {
            name: 'Rain',
            desc: 'Applies your Rain Handling multiplier to every segment score: 0.5x at 0, 1.0x at 50, 1.5x at 75+.',
          },
          {
            name: 'Heavy rain',
            desc: 'Harsher than rain. 0.4x at rain handling 0, 1.0x at 60, 1.4x cap. Low-rain drones get punished more, top-rain drones cap a touch lower.',
          },
          {
            name: 'Wind',
            desc: 'Applies your Wind Resistance multiplier to every segment score (0.5x / 1.0x / 1.5x scale).',
          },
          {
            name: 'Fog',
            desc: 'Visibility hit. Uses Night Vision: 0.6x at 0, 1.0x at 60, 1.4x cap.',
          },
          {
            name: 'Haze',
            desc: 'Light visibility hit. Uses Night Vision: 0.7x at 0, 1.0x at 70, 1.3x cap.',
          },
          {
            name: 'Night (time of day)',
            desc: 'Applies your Night Vision multiplier to every segment score (0.5x / 1.0x / 1.5x scale).',
          },
        ],
      },
      {
        type: 'paragraph',
        text: 'Clear, clouds, dawn, day, and dusk are visual only. They roll into your race log but apply no multiplier.',
      },

      { type: 'subheading', text: 'Laps' },
      {
        type: 'paragraph',
        text: 'Every track is 3 laps. Battery drain is gentle early and ramps aggressively in later laps. Low-battery drones lose serious performance by the final lap, especially on long tracks. A drone with zero battery capacity on a long track can lose most of its segment performance by lap 3. High battery capacity reduces the drain significantly.',
      },

      { type: 'subheading', text: 'Track selection' },
      {
        type: 'paragraph',
        text: "Random pick from tracks whose level range covers your bracket. You don't choose. The track for a race is shown in the race detail view alongside its specs.",
      },
    ],
  },

  {
    id: 'tracks',
    title: 'Tracks',
    Icon: Map,
    blocks: [
      {
        type: 'paragraph',
        text: '16 tracks live today. Every track has a fixed straights count, turns count, length tier (short / medium / long), difficulty rating (1-10), and a level range it serves. All tracks are 3 laps.',
      },

      { type: 'subheading', text: 'Difficulty' },
      {
        type: 'paragraph',
        text: 'Difficulty drives the volts payout. Harder tracks pay winners more. The difficulty also signals layout intensity: more turns, longer length, tighter angles.',
      },

      { type: 'subheading', text: 'Length' },
      {
        type: 'paragraph',
        text: 'Length affects battery drain. Short tracks barely touch battery. Long tracks punish low-battery builds hard.',
      },

      { type: 'subheading', text: 'Level gating' },
      {
        type: 'paragraph',
        text: 'Each track has an inclusive level range. A drone races only on tracks whose range covers its level. As you climb, the eligible track pool rotates.',
      },

      { type: 'subheading', text: 'Current track list' },
      {
        type: 'list',
        items: [
          {
            name: 'Horizon Express',
            desc: '2 straights, 2 turns. Short. Difficulty 1. Levels 1-5.',
          },
          {
            name: 'Neon Straightaway',
            desc: '3 straights, 3 turns. Medium. Difficulty 2. Levels 1-5.',
          },
          { name: 'Keyhole', desc: '2 straights, 2 turns. Short. Difficulty 2. Levels 1-5.' },
          { name: 'The Grid', desc: '4 straights, 4 turns. Medium. Difficulty 3. Levels 1-5.' },
          { name: 'Meridian', desc: '4 straights, 4 turns. Medium. Difficulty 3. Levels 6-10.' },
          {
            name: 'Circuit Alpha',
            desc: '4 straights, 5 turns. Medium. Difficulty 4. Levels 6-10.',
          },
          { name: 'Crossfire', desc: '3 straights, 5 turns. Medium. Difficulty 4. Levels 6-10.' },
          { name: 'Iron Ribbon', desc: '4 straights, 6 turns. Long. Difficulty 5. Levels 6-10.' },
          {
            name: 'Skyline Drift',
            desc: '3 straights, 7 turns. Long. Difficulty 6. Levels 11-15.',
          },
          { name: 'Helix', desc: '2 straights, 6 turns. Medium. Difficulty 6. Levels 11-15.' },
          { name: 'Switchblade', desc: '3 straights, 8 turns. Long. Difficulty 7. Levels 11-15.' },
          {
            name: 'Phantom Circuit',
            desc: '4 straights, 7 turns. Long. Difficulty 7. Levels 11-15.',
          },
          { name: 'Voltage Loop', desc: '4 straights, 8 turns. Long. Difficulty 8. Levels 16-20.' },
          {
            name: 'Obsidian Maze',
            desc: '3 straights, 9 turns. Long. Difficulty 9. Levels 16-20.',
          },
          {
            name: 'Apex Descent',
            desc: '2 straights, 10 turns. Long. Difficulty 9. Levels 16-20.',
          },
          { name: 'Tempest Run', desc: '2 straights, 8 turns. Long. Difficulty 10. Levels 16-20.' },
        ],
      },
    ],
  },

  {
    id: 'leveling',
    title: 'Leveling',
    Icon: TrendingUp,
    blocks: [
      { type: 'subheading', text: 'XP' },
      {
        type: 'paragraph',
        text: 'Both drones in a race gain XP. Win = 10 XP. Loss = 4 XP. XP accumulates automatically.',
      },

      { type: 'subheading', text: 'Level-up' },
      {
        type: 'paragraph',
        text: 'XP requirements increase steeply with each level. Early levels come fast. High levels take serious grinding. Level-ups cascade in one shot if you have the XP banked.',
      },

      { type: 'subheading', text: 'Level benefits' },
      {
        type: 'list',
        items: [
          {
            name: '+20 TSB',
            desc: 'Total Stat Budget grows by 20. More points to allocate across the 9 stats.',
          },
          {
            name: 'Higher per-stat cap',
            desc: "Each stat's cap rises by 4-5. More headroom for specialists.",
          },
          {
            name: '+20 volts',
            desc: 'Paid to your volts balance on every level-up. Spendable anywhere.',
          },
          {
            name: 'Possible tier change',
            desc: "Levels 6, 11, and 16 cross a tier boundary, which changes the drone's appearance.",
          },
        ],
      },

      { type: 'subheading', text: 'Level cap' },
      {
        type: 'paragraph',
        text: 'Level 20 is the max. After that, XP gains stop counting toward level and the bar pins to full. ELO and volts keep going.',
      },

      { type: 'subheading', text: 'Drone tiers' },
      {
        type: 'paragraph',
        text: "Tiers map directly to level brackets and drive the drone's base appearance.",
      },
      { type: 'tierShowcase' },
      {
        type: 'list',
        items: [
          {
            name: 'Tier 1 (Steel)',
            desc: 'Levels 1-5. Open propeller drone. Basic quadcopter design with teal neon accents.',
          },
          {
            name: 'Tier 2 (Orange)',
            desc: 'Levels 6-10. Enclosed rotor shrouds with teal ring lights. More refined body.',
          },
          {
            name: 'Tier 3 (Purple)',
            desc: 'Levels 11-15. Jet booster nacelles with visible turbine fans. Aggressive body.',
          },
          {
            name: 'Tier 4 (Gold)',
            desc: 'Levels 16-20. Integrated supersonic engine pods. Most advanced design.',
          },
        ],
      },
    ],
  },

  {
    id: 'elo-rating',
    title: 'ELO Rating',
    Icon: Trophy,
    blocks: [
      {
        type: 'paragraph',
        text: 'Every drone and every player carries an ELO rating. Both start at 1000.',
      },

      { type: 'subheading', text: 'How it moves' },
      {
        type: 'paragraph',
        text: 'Standard ELO rating system. Beating higher-rated opponents moves your rating more. Beating lower-rated opponents moves it less. Upsets swing big.',
      },

      { type: 'subheading', text: 'What ELO does' },
      {
        type: 'paragraph',
        text: "ELO drives matchmaking inside your level bracket. Drones in a bracket sort by ELO and pair with their nearest neighbor, so high-ELO drones face high-ELO drones. ELO is also tied to the drone, so a drone's rating travels with it through marketplace sales.",
      },

      { type: 'subheading', text: 'Upsets' },
      {
        type: 'paragraph',
        text: 'When a lower-rated drone beats a higher-rated one, the race is flagged UPSET in the log. The winner gets a volts bonus on top of the base payout. The bigger the ELO gap you overcome, the bigger the upset bonus.',
      },
    ],
  },

  {
    id: 'volts-economy',
    title: 'Volts and Economy',
    Icon: Coins,
    blocks: [
      {
        type: 'paragraph',
        text: 'Volts are the only currency, and they are a token on NEAR testnet. One balance per player, shared across all your drones.',
      },

      { type: 'subheading', text: 'Race rewards' },
      {
        type: 'paragraph',
        text: 'Winners earn volts based on their level, track difficulty, whether it was an upset, and how dominant the win was. Higher-level wins on harder tracks pay significantly more. Losers always earn volts. The payout scales with level so high-level losses still feel worthwhile. Every human-owned drone that races earns something.',
      },
      {
        type: 'list',
        items: [
          { name: 'Winner base', desc: '3 volts. Always.' },
          { name: 'Winner level bonus', desc: "Scales with your drone's level." },
          { name: 'Winner difficulty bonus', desc: 'Harder tracks pay more.' },
          {
            name: 'Winner upset bonus',
            desc: 'The bigger the ELO gap you overcome, the bigger the upset bonus.',
          },
          {
            name: 'Winner dominance bonus',
            desc: 'Dominant wins - where you crush the opponent by a wide margin - pay a bonus. The bigger the gap, the bigger the reward.',
          },
          { name: 'Loser base', desc: '1 volt. Always.' },
          {
            name: 'Loser level bonus',
            desc: "Scales with the loser's level so high-level losses still feel worthwhile.",
          },
        ],
      },
      { type: 'subheading', text: 'Other volt income' },
      {
        type: 'list',
        items: [
          {
            name: 'Level-up bonus',
            desc: '+20 volts per level. Paid to your balance on the level-up.',
          },
          { name: 'Marketplace sale', desc: '90% of the sale price (10% platform fee).' },
        ],
      },

      { type: 'subheading', text: 'Volts buy stat allocation' },
      {
        type: 'paragraph',
        text: "You can't buy XP. Leveling up only happens by racing - 10 XP for a win, 4 XP for a loss. Spending volts lets you skip the stat-allocation grind on a drone you own, but it doesn't skip progression. A high-cap level-20 drone still has to race to get there.",
      },

      { type: 'subheading', text: 'Where to spend' },
      {
        type: 'list',
        items: [
          { name: 'Stat upgrades', desc: "Permanent. Cost depends on the stat's current value." },
          {
            name: 'Marketplace',
            desc: 'Drones, unbound skins, and unbound mods listed by other players.',
          },
          {
            name: 'Skin packs',
            desc: 'Starter (2,000), Premium (12,000), Legendary (60,000). 3 skins per pack.',
          },
          {
            name: 'Mod capsules',
            desc: 'Starter (1,000), Premium (6,000), Legendary (30,000). 3 mods per capsule.',
          },
          {
            name: 'NPC drone vendor',
            desc: '3,500 volts buys a fresh Level 1 drone with each stat rolled 1-5, plus one common skin and one common mod bound to the new drone (not equipped). No marketplace dependency, no auction.',
          },
        ],
      },
    ],
  },

  {
    id: 'marketplace',
    title: 'Marketplace',
    Icon: Store,
    blocks: [
      {
        type: 'paragraph',
        text: 'Buy and sell drones, skins, and mods from other players. Listings are visible to everyone.',
      },

      { type: 'subheading', text: 'Rules' },
      {
        type: 'list',
        items: [
          {
            name: 'Platform fee',
            desc: '10% of the sale price (the rake). The seller gets the remaining 90%.',
          },
          { name: 'Minimum listing price', desc: '10 volts. Below that, the listing is rejected.' },
          {
            name: 'Active drones',
            desc: "You can list a drone while it's racing. Listing doesn't deactivate it. The drone keeps racing for you until it sells.",
          },
          {
            name: 'Drone transfer',
            desc: 'A purchased drone arrives with its level, XP, full stat sheet, ELO rating, race history, and its bound skin and mod collections intact.',
          },
          {
            name: 'Bound skins and mods',
            desc: "Anything bound to a drone transfers with the drone on sale. Bound items can't be listed on their own.",
          },
          {
            name: 'Unbound skins and mods',
            desc: "Items you own but haven't bound to a drone can be listed and sold individually.",
          },
          {
            name: 'Cancel anytime',
            desc: 'Cancel your own listing before it sells. The item returns to your inventory.',
          },
        ],
      },
    ],
  },

  {
    id: 'skins',
    title: 'Skins',
    Icon: Sparkles,
    blocks: [
      {
        type: 'paragraph',
        text: "Cosmetic items that change a drone's appearance. Zero effect on race math. 32 designs exist today: 8 commons, 8 rares, 8 epics, 8 legendaries. Each design has a supply cap: 2,200 common, 1,300 rare, 1,100 epic, 50 legendary. Ember, the starter skin, has no cap.",
      },

      { type: 'subheading', text: 'Rarities' },
      {
        type: 'list',
        items: [
          {
            name: 'Common (gray)',
            desc: 'Recolors and surface materials over the current tier silhouette.',
          },
          {
            name: 'Rare (blue)',
            desc: 'Bolder color schemes and metallic finishes. Still tier-aware.',
          },
          {
            name: 'Epic (purple)',
            desc: 'Distinct material treatments and neon accent patterns. Tier-aware.',
          },
          {
            name: 'Legendary (gold)',
            desc: "Unique designs that replace the drone's appearance entirely. Tier-independent.",
          },
        ],
      },

      { type: 'subheading', text: 'Tier-aware vs replacement' },
      {
        type: 'paragraph',
        text: "Legendary skins equip on any tier. They replace the silhouette outright and don't change with tier. Other skins equip only where a render exists for the drone's tier: today that is Ember on tier 1, and Chrome Fury, Crystal Phantom, Dragon Scale, Frozen Abyss, and Obsidian Core on tier 4.",
      },

      { type: 'subheading', text: 'Binding and swapping' },
      {
        type: 'paragraph',
        text: "Binding a skin permanently adds it to a drone's collection. A drone can hold any number of bound skins, and you can swap which one is actively displayed outside the race lock without spending anything. The bind itself is permanent: a bound skin can't be moved to another drone or sold on its own. If you sell the drone on the marketplace, the entire skin collection transfers with it to the buyer.",
      },
      {
        type: 'paragraph',
        text: "Skins you own but haven't bound yet are unbound. Unbound skins sit in your inventory and can be listed on the marketplace as standalone items.",
      },

      { type: 'subheading', text: 'Skin drops' },
      {
        type: 'paragraph',
        text: 'Skin drops are not live in this build. Skins come from skin packs and vendor drones.',
      },

      {
        type: 'paragraph',
        text: "A drone with a skin equipped shows multi-color neon accents. That's the at-a-glance signal of a skinned drone.",
      },
    ],
  },

  {
    id: 'packs',
    title: 'Packs',
    Icon: Package,
    blocks: [
      {
        type: 'paragraph',
        text: 'Two product lines: skin packs (cosmetics) and mod capsules (functional). Both lines come in three tiers - Starter, Premium, Legendary - at the same price points. Every pack opens 3 items. Each slot is either a guaranteed rarity or rolled from a probability table.',
      },

      { type: 'subheading', text: 'Starter Pack - 2,000 volts' },
      {
        type: 'paragraph',
        text: '3 items. Mostly commons, with a small chance at rares or better.',
      },

      { type: 'subheading', text: 'Premium Pack - 12,000 volts' },
      {
        type: 'paragraph',
        text: '3 items. Guaranteed at least one rare. Real chances at epics.',
      },

      { type: 'subheading', text: 'Legendary Pack - 60,000 volts' },
      {
        type: 'paragraph',
        text: '3 items. Strong odds at legendaries and epics. The best chance at top-tier items.',
      },

      { type: 'subheading', text: 'Skin packs vs mod capsules' },
      {
        type: 'paragraph',
        text: 'Skin packs roll skins (cosmetic). Mod capsules roll mods (functional, with bonus + tradeoff). The slot rarity tables above apply to both. Mod capsules are priced separately and run cheaper than skin packs - Starter 1,000 / Premium 6,000 / Legendary 30,000 vs the skin pack tiers of 2,000 / 12,000 / 60,000.',
      },

      { type: 'subheading', text: 'Supply' },
      {
        type: 'paragraph',
        text: 'Each skin design has a supply cap. If every design of a rolled rarity is sold out, that slot mints a placeholder skin of the same rarity and the pack still opens. Mods have no supply limit.',
      },
    ],
  },

  {
    id: 'mods',
    title: 'Mods',
    Icon: Cpu,
    blocks: [
      {
        type: 'paragraph',
        text: 'Mods are equippable drone modifications, and each one is a token on NEAR testnet. The equipped mod changes the stats your drone races with. Every mod gives a bonus in one area at the cost of a penalty in another - there are no pure upgrades, only strategic tradeoffs. The size of both the bonus and the penalty scales with rarity.',
      },

      { type: 'subheading', text: 'Binding and swapping' },
      {
        type: 'paragraph',
        text: "Same model as skins. Binding a mod permanently adds it to a drone's collection. A drone can hold any number of bound mods, and you can swap which one is actively equipped between races without spending anything. The bind itself is permanent: a bound mod can't be moved to another drone or sold on its own. If you sell the drone on the marketplace, the entire mod collection transfers with it to the buyer.",
      },
      {
        type: 'paragraph',
        text: "Mods you own but haven't bound yet are unbound. Unbound mods sit in your inventory and can be listed on the marketplace as standalone items.",
      },

      { type: 'subheading', text: 'Rarity scales the tradeoff' },
      {
        type: 'list',
        items: [
          { name: 'Common', desc: 'Small bonus, minimal penalty. Net edge for general builds.' },
          {
            name: 'Rare',
            desc: 'Moderate bonus, moderate penalty. Specialized builds for specific tracks or conditions.',
          },
          {
            name: 'Epic',
            desc: 'Strong bonus, significant penalty. Dominates in the right matchup, exposed in the wrong one.',
          },
          {
            name: 'Legendary',
            desc: 'Unique abilities (e.g. ignore lap-1 battery drain, double consistency on turns) with a meaningful stat penalty.',
          },
        ],
      },

      { type: 'subheading', text: 'Strategy' },
      {
        type: 'paragraph',
        text: "Every mod is a tradeoff. Reading the matchup means looking at the opponent's build, the track layout, and the rolled conditions. A mod that wins a rainy night track can cripple you on a clear-day sprint. Each race batch shows your upcoming matchup before execution - swap the equipped mod accordingly. A drone with five mods bound for five scenarios is harder to read than one locked into a single equip.",
      },

      { type: 'subheading', text: 'Examples' },
      { type: 'modTable' },
    ],
  },

  {
    id: 'seasons',
    title: 'Seasons',
    Icon: Calendar,
    blocks: [
      { type: 'subheading', text: 'Length' },
      {
        type: 'paragraph',
        text: 'Season 1 runs from November 1 to November 25, 2026. It is the only season so far.',
      },

      { type: 'subheading', text: 'What resets' },
      {
        type: 'list',
        items: [
          { name: 'Season volts', desc: 'Keep counting. No reset in this build.' },
          { name: 'Leaderboard', desc: 'Keeps counting. No reset in this build.' },
        ],
      },

      { type: 'subheading', text: 'What carries over' },
      {
        type: 'list',
        items: [
          { name: 'Drone stats and level', desc: 'Permanent.' },
          { name: 'XP', desc: 'Permanent.' },
          { name: 'ELO', desc: 'Permanent.' },
          { name: 'Volts balance', desc: 'Permanent.' },
          { name: 'Owned drones and skins', desc: 'Permanent.' },
          { name: 'Active drone slots', desc: 'Permanent.' },
        ],
      },

      { type: 'subheading', text: 'Rewards' },
      {
        type: 'paragraph',
        text: 'There are no season rewards in this build.',
      },
    ],
  },

  {
    id: 'active-drone-slots',
    title: 'Active Drone Slots',
    Icon: Zap,
    blocks: [
      {
        type: 'paragraph',
        text: "Slots cap how many of your drones can race per cycle. Inactive drones sit out. Toggle a drone's active flag from its detail page (subject to your slot count).",
      },

      { type: 'subheading', text: 'Slots' },
      {
        type: 'list',
        items: [
          { name: 'Slot 1', desc: 'Granted at signup.' },
          { name: 'Slot 2', desc: 'Opens at 500 total races (across all your drones).' },
          { name: 'Slot 3', desc: 'Opens at 2,000 total races.' },
        ],
      },

      {
        type: 'paragraph',
        text: 'Your slot count updates when a race settles, so the new slot is ready at the next cycle after you cross the threshold.',
      },

      { type: 'subheading', text: 'Activating and Deactivating' },
      {
        type: 'paragraph',
        text: "Toggling a drone's active flag goes through a one-cycle pending state. Switching an inactive drone on shows it as Activating: the drone joins matchmaking at the next 3-minute cycle. Switching an active drone off shows it as Deactivating: the drone races out the current matchup, then drops out of matchmaking starting next cycle.",
      },
      {
        type: 'paragraph',
        text: "Click the toggle a second time while it's still pending to cancel and return the drone to its original state. The strategy lock window does not block these toggles. Only mod and skin swaps lock during that period.",
      },

      { type: 'subheading', text: 'More drones' },
      {
        type: 'paragraph',
        text: 'Additional Level 1 drones are available from the NPC vendor at 3,500 volts each: each stat rolled 1-5, one bound common skin, one bound common mod. There is no marketplace dependency to grow your fleet.',
      },
    ],
  },
];

const MOD_EXAMPLES = [
  { name: 'Streamline Plate', rarity: 'common', bonus: '+2% Speed', tradeoff: '-1% Turning' },
  { name: 'Grip Pads', rarity: 'common', bonus: '+2% Turning', tradeoff: '-1% Speed' },
  { name: 'Steady Module', rarity: 'common', bonus: '+2% Consistency', tradeoff: '-1% Speed' },
  { name: 'Aero Shell', rarity: 'rare', bonus: '+4% Speed', tradeoff: '-2% Turning' },
  { name: 'Storm Plating', rarity: 'rare', bonus: '+4% Rain Handling', tradeoff: '-2% Speed' },
  { name: 'Night Optics', rarity: 'rare', bonus: '+4% Night Vision', tradeoff: '-2% Battery' },
  { name: 'Plasma Core', rarity: 'epic', bonus: '+6% Acceleration', tradeoff: '-4% Consistency' },
  { name: 'Stealth Aero', rarity: 'epic', bonus: '+6% Speed', tradeoff: '-4% Durability' },
  { name: 'Typhoon Module', rarity: 'epic', bonus: '+8% Rain Handling', tradeoff: '-5% Speed' },
  {
    name: 'Phantom Drive',
    rarity: 'legendary',
    bonus: 'Ignores lap 1 battery drain',
    tradeoff: '-5% Wind Resistance',
  },
  {
    name: 'Quantum Sync',
    rarity: 'legendary',
    bonus: 'Consistency doubles on turns',
    tradeoff: '-4% Speed',
  },
  {
    name: 'Storm Rider',
    rarity: 'legendary',
    bonus: 'All weather penalties -50%',
    tradeoff: '-6% Acceleration',
  },
];

/** Capitalize a rarity key for table display. */
function rarityLabel(rarity) {
  return rarity.charAt(0).toUpperCase() + rarity.slice(1);
}

/**
 * Overview sections that sit above the deep-dive SECTIONS array.
 * Conceptual primers; the existing SECTIONS hold the detailed mechanics.
 */
const PRE_SECTIONS = [
  {
    id: 'how-racing-works',
    title: 'How Racing Works',
    Icon: Timer,
    blocks: [
      { type: 'subheading', text: 'Race Batches' },
      {
        type: 'paragraph',
        text: 'Races run in automated batches on a regular cycle. When a batch triggers, the system pairs active drones within their level bracket (1-5, 6-10, 11-15, 16-20) using ELO ratings. Higher-rated drones face higher-rated opponents. Bots bring each active bracket up to at least 5 drones, rounded up to even.',
      },
      { type: 'subheading', text: 'Track Assignment' },
      {
        type: 'paragraph',
        text: "Each race is assigned a track filtered by the drones' level range. Tracks have minimum and maximum level requirements, difficulty ratings, and unique characteristics: different ratios of straights to turns, varying lengths, and signature conditions.",
      },
      { type: 'subheading', text: 'The Strategy Window' },
      {
        type: 'paragraph',
        text: "When matchmaking completes, the batch is committed on NEAR testnet and a 120-second strategy window opens. During this window you see the upcoming matchup: your drone vs the opponent, the track layout, the rolled weather, and the time of day. This is the window where you swap the equipped mod on your drone to adapt to the matchup. The page closes the window 3 seconds before the on-chain lock, so a late swap can't fail. At 120 seconds the race locks. It runs and settles at the next cycle.",
      },
      {
        type: 'paragraph',
        text: 'Active / inactive toggles are not blocked during the strategy window or the execution lock that follows it. Mod and skin swaps on the queued drone lock once the strategy timer expires. See the Active Drone Slots section for how the pending Activating and Deactivating states resolve.',
      },
      { type: 'subheading', text: 'Race Simulation' },
      {
        type: 'paragraph',
        text: 'The race engine simulates each race segment by segment across 3 laps. Segments are either straights or turns, and different stats carry different weight on each type. Weather conditions (clear, rain, wind) and time of day (day, night) apply modifiers to relevant stats. Battery degrades across laps. Lap 1 barely drains it, later laps test your Battery Capacity stat. The drone with the lowest total time wins.',
      },
      { type: 'subheading', text: 'Rewards and Progression' },
      {
        type: 'paragraph',
        text: 'Winners earn 10 XP plus tiered volts: a base payout plus level, difficulty, upset, and dominance bonuses. Losers earn 4 XP plus a base volt scaled by their level. ELO ratings adjust based on the outcome. Upsets (a lower-rated drone beating a higher-rated one) flag in the log and pay a volts bonus to the winner. XP drives leveling, which raises stat caps and opens harder tracks. Volts fund the rest of the economy: stat upgrades, packs, NPC vendor purchases, and Marketplace buys. You cannot buy XP - leveling only happens by racing.',
      },
      { type: 'subheading', text: 'Active Drone Slots' },
      {
        type: 'paragraph',
        text: 'You start with 1 active drone slot. Slot 2 opens at 500 total races, slot 3 at 2,000. Only active drones enter race batches. Changes to active/inactive status take effect after the current race batch resolves.',
      },
    ],
  },
  {
    id: 'the-economy',
    title: 'The Economy',
    Icon: Wallet,
    blocks: [
      { type: 'subheading', text: 'Volts' },
      {
        type: 'paragraph',
        text: "Volts are the only in-game currency. You earn them by racing. Winners take 3 base plus level, difficulty, upset, and dominance bonuses; losers take 1 base plus a level bonus. Volts buy stat upgrades, packs, NPC vendor drones (3,500V each), and other players' listings on the Marketplace.",
      },
      { type: 'subheading', text: 'The Marketplace' },
      {
        type: 'paragraph',
        text: "The Marketplace is where players trade drones, skins, and mods with each other. All listings are priced in volts. A 10% rake is applied to every sale - the platform's only fee. Active drones can be listed and keep racing until they sell. A drone's entire bound skin and mod collection transfers with it.",
      },
      { type: 'subheading', text: 'Packs' },
      {
        type: 'paragraph',
        text: 'Two product lines: skin packs (cosmetics) and mod capsules (functional). Each comes in three tiers - Starter, Premium, and Legendary - sharing the same slot rarity tables. Skin packs cost 2,000 / 12,000 / 60,000; mod capsules cost 1,000 / 6,000 / 30,000. Every pack opens 3 items.',
      },
      { type: 'subheading', text: 'Building value' },
      {
        type: 'paragraph',
        text: "A drone's market value comes from the time invested in building it. Level, stat allocation, the bound skin and mod collection, and ELO history all contribute. Stat allocations are permanent - there is no respec. A well-built drone is what other players want to own.",
      },
    ],
  },
];

/** TOC entries: conceptual primers, then deep-dives. */
const TOC_ENTRIES = [...PRE_SECTIONS, ...SECTIONS];

export default function GuidePage() {
  const [activeId, setActiveId] = useState(TOC_ENTRIES[0].id);
  const [mobileOpen, setMobileOpen] = useState(false);
  const sectionRefs = useRef({});

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.target.offsetTop - b.target.offsetTop);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: '-20% 0px -60% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );

    TOC_ENTRIES.forEach((s) => {
      const el = sectionRefs.current[s.id];
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  const handleTocClick = (e, id) => {
    e.preventDefault();
    setActiveId(id);
    setMobileOpen(false);
    // Two RAFs: the first lets React flush the setMobileOpen state,
    // the second lets the browser relayout (the open dropdown was
    // taking ~250px of vertical space; collapsing it shifts the page
    // upward). Only THEN do we read the section's position and
    // scrollIntoView, so the scroll target reflects post-collapse
    // layout. Without this, the scroll resolved against pre-collapse
    // coords and the user landed just below the section heading
    // after the layout shifted up around the smooth scroll.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = sectionRefs.current[id];
        if (!el) return;
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    });
  };

  const activeSection = TOC_ENTRIES.find((s) => s.id === activeId) ?? TOC_ENTRIES[0];

  return (
    <NavShell>
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Game Guide</h1>
          <p className={styles.pageSubtitle}>
            Drones, racing, and the economy. Numbers are the source.
          </p>
        </header>

        <div className={styles.tocMobile}>
          <button
            type="button"
            className={styles.tocMobileBtn}
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="guide-toc-mobile-list"
          >
            <span className={styles.tocMobileLabel}>
              <activeSection.Icon size={14} aria-hidden="true" />
              {activeSection.title}
            </span>
            <ChevronDown
              size={16}
              className={cn(styles.tocMobileChevron, mobileOpen && styles.tocMobileChevronOpen)}
              aria-hidden="true"
            />
          </button>
          {mobileOpen && (
            <ul id="guide-toc-mobile-list" className={styles.tocMobileList}>
              {TOC_ENTRIES.map(({ id, title, Icon }) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    onClick={(e) => handleTocClick(e, id)}
                    className={cn(styles.tocLink, activeId === id && styles.tocLinkActive)}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span>{title}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.layout}>
          <nav className={styles.toc} aria-label="Guide sections">
            <div className={styles.tocLabel}>Contents</div>
            <ul className={styles.tocList}>
              {TOC_ENTRIES.map(({ id, title, Icon }) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    onClick={(e) => handleTocClick(e, id)}
                    className={cn(styles.tocLink, activeId === id && styles.tocLinkActive)}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span>{title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className={styles.content}>
            {[...PRE_SECTIONS, ...SECTIONS].map(({ id, title, Icon, blocks }) => (
              <section
                key={id}
                id={id}
                ref={(el) => {
                  sectionRefs.current[id] = el;
                }}
                className={styles.section}
              >
                <Card className={styles.sectionCard}>
                  <div className={styles.sectionHeading}>
                    <Icon size={14} aria-hidden="true" />
                    <span>{title}</span>
                  </div>
                  <div className={styles.sectionBody}>
                    {blocks.map((block, i) => (
                      <Block key={i} block={block} />
                    ))}
                  </div>
                </Card>
              </section>
            ))}
          </div>
        </div>
      </div>
    </NavShell>
  );
}

function Block({ block }) {
  if (block.type === 'subheading') {
    return <h3 className={styles.subheading}>{block.text}</h3>;
  }
  if (block.type === 'paragraph') {
    return <p className={styles.paragraph}>{block.text}</p>;
  }
  if (block.type === 'list') {
    return (
      <dl className={styles.list}>
        {block.items.map((item, i) => (
          <div key={i} className={styles.listRow}>
            <dt className={styles.listTerm}>{item.name}</dt>
            <dd className={styles.listDesc}>{item.desc}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (block.type === 'costTable') {
    return (
      <div className={styles.costTable} role="table">
        <div className={styles.costHeader} role="row">
          <span role="columnheader">Stat Value</span>
          <span role="columnheader">Cost</span>
        </div>
        {block.rows.map((row, i) => (
          <div key={i} className={styles.costRow} role="row">
            <span role="cell">{row.range}</span>
            <span role="cell">{row.cost}</span>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === 'tierShowcase') {
    return (
      <div className={styles.tierShowcase}>
        {DRONE_TIERS.map((t) => (
          <div key={t.tier} className={styles.tierCard}>
            <div className={styles.tierImage}>
              <DroneImage drone={{ level: t.level }} alt={`Tier ${t.tier} drone`} />
            </div>
            <div className={cn(styles.tierLabel, styles[`tier_${t.color}`])}>
              Tier {t.tier} · {t.label}
            </div>
            <div className={styles.tierLevels}>L{t.range}</div>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === 'modTable') {
    return (
      <div className={cn(styles.costTable, styles.modTable)} role="table">
        <div className={styles.costHeader} role="row">
          <span role="columnheader">Mod Name</span>
          <span role="columnheader">Rarity</span>
          <span role="columnheader">Bonus</span>
          <span role="columnheader">Tradeoff</span>
        </div>
        {MOD_EXAMPLES.map((row, i) => (
          <div key={i} className={styles.costRow} role="row">
            <span role="cell">{row.name}</span>
            <span role="cell" className={styles[`rarity_${row.rarity}`]}>
              {rarityLabel(row.rarity)}
            </span>
            <span role="cell">{row.bonus}</span>
            <span role="cell">{row.tradeoff}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
}
