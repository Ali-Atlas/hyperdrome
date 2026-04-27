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
  { tier: 1, label: 'Steel',  range: '1-5',   color: 'steel',  level: 1  },
  { tier: 2, label: 'Orange', range: '6-10',  color: 'orange', level: 6  },
  { tier: 3, label: 'Purple', range: '11-15', color: 'purple', level: 11 },
  { tier: 4, label: 'Gold',   range: '16-20', color: 'gold',   level: 16 },
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
        text: 'Passive competitive drone racing. You own drones, allocate stats, and they race automatically every 3 minutes. A weighted simulation decides each race using your stats vs. the opponent\'s, the track layout, the rolled weather, the time of day, and a small dampened random variance. Wins pay volts and XP. Volts spend on stat upgrades, marketplace buys, and packs. Seasons run 30 days.',
      },
      { type: 'subheading', text: 'Creating your account' },
      {
        type: 'paragraph',
        text: 'Sign up with email. We send a magic link. No password. On first sign-in you get a free Level 1 starter drone, your wallet starts at 0 volts, your account starts at ELO 1000 with 1 active drone slot.',
      },
      { type: 'subheading', text: 'Your first drone' },
      {
        type: 'paragraph',
        text: 'Level 1, all 9 stats at 1, Total Stat Budget of 29, active by default. It enters the next race cycle automatically. The 9 stats sum to 9 already, so you have 20 points of TSB headroom to allocate as you earn. Every upgrade costs volts from your wallet, so the first wins fund the first upgrades.',
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
        text: 'On every track segment (a straight or a turn), each drone gets a score from a weighted combination of stats. Score becomes time on that segment via 100 / score. The drone with the lowest total time across all segments and laps wins.',
      },
      {
        type: 'list',
        items: [
          { name: 'Speed', desc: '40% weight on straight segments. 0% on turns. Higher speed lowers your time on straights.' },
          { name: 'Turning', desc: '40% weight on turn segments. 0% on straights. Higher turning lowers your time on turns.' },
          { name: 'Acceleration', desc: '30% weight on straights, 20% on turns. Pulls weight on every segment.' },
          { name: 'Durability', desc: '25% weight on turns, 0% on straights. Reduces turn penalties.' },
          { name: 'Consistency', desc: '15% weight on both straights and turns. Also dampens the random variance applied to every segment score. At consistency 0 the variance is +/- 5%. At 100 it\'s near zero.' },
          { name: 'Battery Capacity', desc: 'No direct segment weight. Reduces battery degradation that ramps from lap 2 to the final lap. At 100 there\'s zero drain. At 0 a long-track segment can lose up to 60% of its score by the final lap.' },
          { name: 'Night Vision', desc: 'Only triggers when time of day rolls "night". At 0 it\'s a 0.5x multiplier on every segment score, at 50 it\'s neutral (1.0x), capped at 1.5x past 75.' },
          { name: 'Rain Handling', desc: 'Only triggers in "rain" or "heavy rain" weather. Same 0.5x at 0, 1.0x at 50, capped at 1.5x.' },
          { name: 'Wind Resistance', desc: '15% weight on every straight regardless of weather. In "wind" weather, additionally applies the 0.5x / 1.0x / 1.5x multiplier on every segment.' },
        ],
      },

      { type: 'subheading', text: 'Total Stat Budget (TSB)' },
      {
        type: 'paragraph',
        text: 'Your drone\'s 9 stats can sum to at most TSB. Formula: TSB = 9 + 20 * level. Level 1: 29. Level 5: 109. Level 10: 209. Level 15: 309. Level 20: 409.',
      },

      { type: 'subheading', text: 'Per-Stat Cap' },
      {
        type: 'paragraph',
        text: 'No single stat can exceed the cap for your level. Formula: cap = min(100, 10 + floor(4.5 * level)). Level 1: 14. Level 5: 32. Level 10: 55. Level 15: 77. Level 20: 100. The cap stops you from dumping your entire budget into one stat early.',
      },

      { type: 'subheading', text: 'Stat upgrade costs' },
      {
        type: 'paragraph',
        text: 'Each upgrade is paid in volts from your wallet. Cost depends on the stat\'s current value: 1 + floor(currentValue / 10). Costs scale in 10-step bands.',
      },
      {
        type: 'costTable',
        rows: [
          { range: 'Stat 1 -> 9', cost: '1 volt per upgrade' },
          { range: 'Stat 10 -> 19', cost: '2 volts per upgrade' },
          { range: 'Stat 20 -> 29', cost: '3 volts per upgrade' },
          { range: 'Stat 30 -> 39', cost: '4 volts per upgrade' },
          { range: 'Stat 40 -> 49', cost: '5 volts per upgrade' },
          { range: 'Stat 50 -> 59', cost: '6 volts per upgrade' },
          { range: 'Stat 60 -> 69', cost: '7 volts per upgrade' },
          { range: 'Stat 70 -> 79', cost: '8 volts per upgrade' },
          { range: 'Stat 80 -> 89', cost: '9 volts per upgrade' },
          { range: 'Stat 90 -> 99', cost: '10 volts per upgrade' },
        ],
      },
      {
        type: 'paragraph',
        text: 'Raising one stat from 1 to 100 costs 460 volts total. The first 9 volts are cheap. Past 50 it gets expensive fast.',
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
        text: 'Every 3 minutes the race cycle runs. All active drones get matched and raced. Result lands in your race log with the segment-by-segment data, the ELO change, the volts payout, the XP, and the race conditions that rolled.',
      },

      { type: 'subheading', text: 'Matchmaking' },
      {
        type: 'paragraph',
        text: 'Drones group into level brackets: 1-5, 6-10, 11-15, 16-20. Inside a bracket, drones sort by ELO and pair with the next-closest rating. A bot backfill keeps every active bracket at minimum 4 drones, rounded up to even, so every active drone races every cycle. No byes.',
      },

      { type: 'subheading', text: 'Race simulation' },
      {
        type: 'paragraph',
        text: 'Each track is a fixed list of straights and turns, shuffled into a segment order at race start. The same shuffled order repeats every lap. For each segment, both drones get a score from the weighted stat formula, multiplied by any weather and time-of-day modifiers, multiplied by battery degradation for that lap, multiplied by a small variance dampened by consistency. Score becomes time via 100 / score. Times accumulate. Lower total time wins.',
      },

      { type: 'subheading', text: 'Weather and time of day' },
      {
        type: 'paragraph',
        text: '7 weathers roll randomly per race: clear, clouds, rain, heavy rain, wind, haze, fog. 4 times of day: dawn, day, dusk, night. Only 3 conditions apply a stat multiplier:',
      },
      {
        type: 'list',
        items: [
          { name: 'Rain / Heavy rain', desc: 'Applies your Rain Handling multiplier to every segment score (0.5x at 0, 1.0x at 50, 1.5x at 75+).' },
          { name: 'Wind', desc: 'Applies your Wind Resistance multiplier to every segment score (same scale).' },
          { name: 'Night', desc: 'Applies your Night Vision multiplier to every segment score (same scale).' },
        ],
      },
      {
        type: 'paragraph',
        text: 'Clear, clouds, haze, fog, dawn, day, and dusk are visual only. They roll into your race log but apply no multiplier.',
      },

      { type: 'subheading', text: 'Laps' },
      {
        type: 'paragraph',
        text: 'Every track is 3 laps. Battery degradation is 0 on lap 1, ramps linearly to its peak on the final lap. Peak per-segment hit = (100 - your battery) / 100 * 0.5 * length multiplier. Length multiplier is 0.8 short, 1.0 medium, 1.2 long. So a 0-battery drone on a long track loses up to 60% of its segment scores by lap 3. A 100-battery drone loses nothing.',
      },

      { type: 'subheading', text: 'Track selection' },
      {
        type: 'paragraph',
        text: 'Random pick from tracks whose level range covers your bracket. You don\'t choose. The track for a race is shown in the race detail view alongside its specs.',
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
        text: '7 tracks live today. More on the way. Every track has a fixed straights count, turns count, length tier (short / medium / long), difficulty rating (1-10), and a level range it serves. All tracks are 3 laps.',
      },

      { type: 'subheading', text: 'Difficulty' },
      {
        type: 'paragraph',
        text: 'Difficulty drives the volts payout. Winner gets a bonus of floor(difficulty / 2). Difficulty 1 pays +0. Difficulty 2-3 pays +1. Difficulty 4-5 pays +2. Difficulty 6-7 pays +3. Difficulty 8-9 pays +4. Difficulty 10 pays +5. The difficulty also signals layout intensity: more turns, longer length, tighter angles.',
      },

      { type: 'subheading', text: 'Length' },
      {
        type: 'paragraph',
        text: 'Length is a multiplier on battery drain: short 0.8x, medium 1.0x, long 1.2x. Long tracks punish low battery builds. Short tracks barely touch battery at all.',
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
          { name: 'Neon Straightaway', desc: '8 straights, 2 turns. Short. Difficulty 2. Levels 1-5. A grinder for speedsters at low level.' },
          { name: 'The Grid', desc: '6 straights, 4 turns. Short. Difficulty 3. Levels 1-10. Mixed layout, broad bracket.' },
          { name: 'Circuit Alpha', desc: '5 straights, 5 turns. Medium. Difficulty 4. Levels 1-10. Even split favors balanced builds.' },
          { name: 'Skyline Drift', desc: '3 straights, 7 turns. Medium. Difficulty 5. Levels 6-15. Heavy turn count rewards turning + durability.' },
          { name: 'Voltage Loop', desc: '4 straights, 8 turns. Long. Difficulty 7. Levels 6-20. Long means battery matters. 12 segments per lap.' },
          { name: 'Tempest Run', desc: '2 straights, 8 turns. Long. Difficulty 9. Levels 11-20. Top-bracket volts. Tight, technical, battery-heavy.' },
          { name: 'Horizon Express', desc: '9 straights, 1 turn. Medium. Difficulty 1. Levels 1-10. Almost pure straights. Speed dominates.' },
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
        text: 'XP needed for the next level = 300 * level^2. Level 1 to 2: 300 XP. 2 to 3: 1,200. 3 to 4: 2,700. 5 to 6: 7,500. 10 to 11: 30,000. 15 to 16: 67,500. 19 to 20: 108,300. Level-ups cascade in one shot if you have the XP banked.',
      },

      { type: 'subheading', text: 'Level benefits' },
      {
        type: 'list',
        items: [
          { name: '+20 TSB', desc: 'Total Stat Budget grows by 20. More points to allocate across the 9 stats.' },
          { name: 'Higher per-stat cap', desc: 'Each stat\'s cap rises by 4-5. More headroom for specialists.' },
          { name: '+20 volts', desc: 'Paid into your wallet on every level-up. Spendable anywhere.' },
          { name: 'Possible tier change', desc: 'Levels 6, 11, and 16 cross a tier boundary, which changes the drone\'s appearance.' },
        ],
      },

      { type: 'subheading', text: 'Level cap' },
      {
        type: 'paragraph',
        text: 'Level 20 is the max. After that, XP gains stop counting toward level and the bar pins to full. ELO, volts, season volts, and skin progression keep going.',
      },

      { type: 'subheading', text: 'Drone tiers' },
      {
        type: 'paragraph',
        text: 'Tiers map directly to level brackets and drive the drone\'s base appearance.',
      },
      { type: 'tierShowcase' },
      {
        type: 'list',
        items: [
          { name: 'Tier 1 (Steel)', desc: 'Levels 1-5. Open propeller drone. Basic quadcopter design with teal neon accents.' },
          { name: 'Tier 2 (Orange)', desc: 'Levels 6-10. Enclosed rotor shrouds with teal ring lights. More refined body.' },
          { name: 'Tier 3 (Purple)', desc: 'Levels 11-15. Jet booster nacelles with visible turbine fans. Aggressive body.' },
          { name: 'Tier 4 (Gold)', desc: 'Levels 16-20. Integrated supersonic engine pods. Most advanced design.' },
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
        text: 'Standard ELO with K-factor 32. Same-rated win swings +/- 16. Beating someone 200 ELO above you swings around +24 to you, -24 to them. Beating someone 200 below swings around +8 / -8.',
      },

      { type: 'subheading', text: 'What ELO does' },
      {
        type: 'paragraph',
        text: 'ELO drives matchmaking inside your level bracket. Drones in a bracket sort by ELO and pair with their nearest neighbor, so high-ELO drones face high-ELO drones. ELO is also tied to the drone, so a drone\'s rating travels with it through marketplace sales.',
      },

      { type: 'subheading', text: 'Upsets' },
      {
        type: 'paragraph',
        text: 'When a lower-rated drone beats a higher-rated one, the race is flagged UPSET in the log. The winner gets a volts bonus on top of the base payout: floor((loserElo - winnerElo) / 100). 100 ELO underdog: +1 volt. 250 underdog: +2. 500 underdog: +5.',
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
        text: 'Volts are the only currency. One wallet per player, shared across all your drones.',
      },

      { type: 'subheading', text: 'Race rewards' },
      {
        type: 'paragraph',
        text: 'Winner payout = 3 base + floor(track difficulty / 2) + max(0, floor((loserElo - winnerElo) / 100)). Losers earn a flat 2 volts as a participation payout, so every active drone earns something every cycle.',
      },
      {
        type: 'list',
        items: [
          { name: 'Loser payout', desc: '2 volts. Every race, regardless of result.' },
          { name: 'Min winner payout', desc: '3 volts. Difficulty-1 track, no upset.' },
          { name: 'Mid winner payout', desc: '5 volts. Difficulty-5 track (+2), even matchup.' },
          { name: 'Strong winner payout', desc: '7 volts. Difficulty-9 track (+4), even matchup.' },
          { name: 'Big upset', desc: '12 volts. Difficulty-9 track (+4), 500 ELO underdog (+5).' },
        ],
      },

      { type: 'subheading', text: 'Other volt income' },
      {
        type: 'list',
        items: [
          { name: 'Level-up bonus', desc: '+20 volts per level. Paid into your wallet on the level-up.' },
          { name: 'Marketplace sale', desc: '95% of the sale price (5% platform fee).' },
        ],
      },

      { type: 'subheading', text: 'Volts buy stat allocation' },
      {
        type: 'paragraph',
        text: 'You can\'t buy XP. Leveling up only happens by racing - 10 XP for a win, 4 XP for a loss. Buying volts lets you skip the stat-allocation grind on a drone you own, but it doesn\'t skip progression. A high-cap level-20 drone still has to race to get there.',
      },

      { type: 'subheading', text: 'Where to spend' },
      {
        type: 'list',
        items: [
          { name: 'Stat upgrades', desc: 'Permanent. Cost depends on the stat\'s current value.' },
          { name: 'Marketplace', desc: 'Drones, unbound skins, and unbound mods listed by other players.' },
          { name: 'Skin packs', desc: 'Starter (500), Premium (2,000), Legendary (10,000). 3 skins per pack.' },
          { name: 'Mod capsules', desc: 'Starter (500), Premium (2,000), Legendary (10,000). 3 mods per capsule.' },
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
          { name: 'Platform fee', desc: '5% of the sale price (the rake). The seller gets the remaining 95%.' },
          { name: 'Minimum listing price', desc: '10 volts. Below that, the listing is rejected.' },
          { name: 'Active drones', desc: 'You can list a drone while it\'s racing. Listing doesn\'t deactivate it. The drone keeps racing for you until it sells.' },
          { name: 'Drone transfer', desc: 'A purchased drone arrives with its level, XP, full stat sheet, ELO rating, race history, and its bound skin and mod collections intact.' },
          { name: 'Bound skins and mods', desc: 'Anything bound to a drone transfers with the drone on sale. Bound items can\'t be listed on their own.' },
          { name: 'Unbound skins and mods', desc: 'Items you own but haven\'t bound to a drone can be listed and sold individually.' },
          { name: 'Cancel anytime', desc: 'Cancel your own listing before it sells. The item returns to your inventory.' },
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
        text: 'Cosmetic items that change a drone\'s appearance. Zero effect on race math. 56 skins exist today: 30 commons, 15 rares, 8 epics, 3 legendaries.',
      },

      { type: 'subheading', text: 'Rarities' },
      {
        type: 'list',
        items: [
          { name: 'Common (gray)', desc: 'Recolors and surface materials over the current tier silhouette.' },
          { name: 'Rare (blue)', desc: 'Bolder color schemes and metallic finishes. Still tier-aware.' },
          { name: 'Epic (purple)', desc: 'Distinct material treatments and neon accent patterns. Tier-aware.' },
          { name: 'Legendary (gold)', desc: 'Unique one-of-a-kind designs that replace the drone\'s appearance entirely. Tier-independent.' },
        ],
      },

      { type: 'subheading', text: 'Tier-aware vs replacement' },
      {
        type: 'paragraph',
        text: 'Common, Rare, and Epic skins layer over the current tier silhouette. When the drone hits a new tier (level 6, 11, 16), the skin re-applies on the new silhouette. Legendary skins replace the silhouette outright and don\'t change with tier.',
      },

      { type: 'subheading', text: 'Binding and swapping' },
      {
        type: 'paragraph',
        text: 'Binding a skin permanently adds it to a drone\'s collection. A drone can hold any number of bound skins, and you can swap which one is actively displayed at any time without spending anything. The bind itself is permanent: a bound skin can\'t be moved to another drone or sold on its own. If you sell the drone on the marketplace, the entire skin collection transfers with it to the buyer.',
      },
      {
        type: 'paragraph',
        text: 'Skins you own but haven\'t bound yet are unbound. Unbound skins sit in your inventory and can be listed on the marketplace as standalone items.',
      },

      { type: 'subheading', text: 'Skin drops' },
      {
        type: 'paragraph',
        text: 'Skins drop randomly per race. Per-race chance: 5% common, 2% rare, 0.5% epic, 0.1% legendary. Drops land unbound in your inventory.',
      },

      {
        type: 'paragraph',
        text: 'A drone with a skin equipped shows multi-color neon accents. That\'s the at-a-glance signal of a skinned drone.',
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
        text: 'Two product lines: skin packs (cosmetics) and mod capsules (functional). Both lines come in three tiers - Starter, Premium, Legendary - at the same price points. Every pack opens 3 items. Each slot has a guaranteed minimum rarity or a probability table.',
      },

      { type: 'subheading', text: 'Starter Pack - 500 volts' },
      {
        type: 'list',
        items: [
          { name: 'Slot 1', desc: 'Common (guaranteed).' },
          { name: 'Slot 2', desc: 'Common (guaranteed).' },
          { name: 'Slot 3', desc: 'Rare 70% / Epic 25% / Legendary 5%.' },
        ],
      },

      { type: 'subheading', text: 'Premium Pack - 2,000 volts' },
      {
        type: 'list',
        items: [
          { name: 'Slot 1', desc: 'Rare (guaranteed).' },
          { name: 'Slot 2', desc: 'Epic 60% / Legendary 40%.' },
          { name: 'Slot 3', desc: 'Common 40% / Rare 35% / Epic 20% / Legendary 5%.' },
        ],
      },

      { type: 'subheading', text: 'Legendary Pack - 10,000 volts' },
      {
        type: 'list',
        items: [
          { name: 'Slot 1', desc: 'Epic (guaranteed).' },
          { name: 'Slot 2', desc: 'Legendary (guaranteed).' },
          { name: 'Slot 3', desc: 'Rare 30% / Epic 50% / Legendary 20%.' },
        ],
      },

      { type: 'subheading', text: 'Skin packs vs mod capsules' },
      {
        type: 'paragraph',
        text: 'Skin packs roll skins (cosmetic). Mod capsules roll mods (functional, with bonus + tradeoff). The slot rarity tables above apply to both. Pick the line that matches what you\'re collecting; the volt prices and odds are identical.',
      },

      { type: 'subheading', text: 'Vault rules' },
      {
        type: 'paragraph',
        text: 'Items in a pack come from the public unowned vault. If the vault runs out of a rarity at open time, the pack open is rejected and your wallet isn\'t charged.',
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
        text: 'Mods are equippable drone modifications. Every mod gives a bonus in one area at the cost of a penalty in another - there are no pure upgrades, only strategic tradeoffs. The size of both the bonus and the penalty scales with rarity.',
      },

      { type: 'subheading', text: 'Binding and swapping' },
      {
        type: 'paragraph',
        text: 'Same model as skins. Binding a mod permanently adds it to a drone\'s collection. A drone can hold any number of bound mods, and you can swap which one is actively equipped between races without spending anything. The bind itself is permanent: a bound mod can\'t be moved to another drone or sold on its own. If you sell the drone on the marketplace, the entire mod collection transfers with it to the buyer.',
      },
      {
        type: 'paragraph',
        text: 'Mods you own but haven\'t bound yet are unbound. Unbound mods sit in your inventory and can be listed on the marketplace as standalone items.',
      },

      { type: 'subheading', text: 'Rarity scales the tradeoff' },
      {
        type: 'list',
        items: [
          { name: 'Common', desc: 'Small bonus, minimal penalty. Net edge for general builds.' },
          { name: 'Rare', desc: 'Moderate bonus, moderate penalty. Specialized builds for specific tracks or conditions.' },
          { name: 'Epic', desc: 'Strong bonus, significant penalty. Dominates in the right matchup, exposed in the wrong one.' },
          { name: 'Legendary', desc: 'Unique abilities (e.g. ignore lap-1 battery drain, double consistency on turns) with a meaningful stat penalty.' },
        ],
      },

      { type: 'subheading', text: 'Strategy' },
      {
        type: 'paragraph',
        text: 'Every mod is a tradeoff. Reading the matchup means looking at the opponent\'s build, the track layout, and the rolled conditions. A mod that wins a rainy night track can cripple you on a clear-day sprint. Each race batch shows your upcoming matchup before execution - swap the equipped mod accordingly. A drone with five mods bound for five scenarios is harder to read than one locked into a single equip.',
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
        text: '30 days per season. The current season number, start date, end date, and days remaining show on the leaderboard.',
      },

      { type: 'subheading', text: 'What resets' },
      {
        type: 'list',
        items: [
          { name: 'Season volts', desc: 'Reset to 0 at season-end.' },
          { name: 'Leaderboard', desc: 'Wiped. New season starts fresh.' },
        ],
      },

      { type: 'subheading', text: 'What carries over' },
      {
        type: 'list',
        items: [
          { name: 'Drone stats and level', desc: 'Permanent.' },
          { name: 'XP', desc: 'Permanent.' },
          { name: 'ELO', desc: 'Permanent.' },
          { name: 'Volts wallet', desc: 'Permanent.' },
          { name: 'Owned drones and skins', desc: 'Permanent.' },
          { name: 'Active drone slots', desc: 'Permanent.' },
        ],
      },

      { type: 'subheading', text: 'Rewards' },
      {
        type: 'paragraph',
        text: 'Top finishers earn season-end rewards. Reward distribution happens at the season cutover.',
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
        text: 'Slots cap how many of your drones can race per cycle. Inactive drones sit out. Toggle a drone\'s active flag from its detail page (subject to your slot count).',
      },

      { type: 'subheading', text: 'Unlocks' },
      {
        type: 'list',
        items: [
          { name: 'Slot 1', desc: 'Granted at signup.' },
          { name: 'Slot 2', desc: 'Unlocks at 500 total races (across all your drones).' },
          { name: 'Slot 3', desc: 'Unlocks at 2,000 total races.' },
        ],
      },

      {
        type: 'paragraph',
        text: 'Slot unlocks check on every race cycle, so the new slot becomes available the next time the cycle runs after you cross the threshold.',
      },
    ],
  },
];

const MOD_EXAMPLES = [
  { name: 'Streamline Plate', rarity: 'common',    bonus: '+2% Speed',                    tradeoff: '-1% Turning' },
  { name: 'Grip Pads',        rarity: 'common',    bonus: '+2% Turning',                  tradeoff: '-1% Speed' },
  { name: 'Steady Module',    rarity: 'common',    bonus: '+2% Consistency',              tradeoff: '-1% Speed' },
  { name: 'Aero Shell',       rarity: 'rare',      bonus: '+4% Speed (straights)',        tradeoff: '-2% Turning' },
  { name: 'Storm Plating',    rarity: 'rare',      bonus: '+4% Rain Handling',            tradeoff: '-2% Speed' },
  { name: 'Night Optics',     rarity: 'rare',      bonus: '+4% Night Vision',             tradeoff: '-2% Battery' },
  { name: 'Plasma Core',      rarity: 'epic',      bonus: '+6% Acceleration',             tradeoff: '-4% Consistency' },
  { name: 'Stealth Aero',     rarity: 'epic',      bonus: '+6% Speed',                    tradeoff: '-4% Durability' },
  { name: 'Typhoon Module',   rarity: 'epic',      bonus: '+8% Rain Handling',            tradeoff: '-5% Speed' },
  { name: 'Phantom Drive',    rarity: 'legendary', bonus: 'Ignores lap 1 battery drain',  tradeoff: '-5% Wind Resistance' },
  { name: 'Quantum Sync',     rarity: 'legendary', bonus: 'Consistency doubles on turns', tradeoff: '-4% Speed' },
  { name: 'Storm Rider',      rarity: 'legendary', bonus: 'All weather penalties -50%',   tradeoff: '-6% Acceleration' },
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
        text: 'Races run in automated batches on a regular cycle. When a batch triggers, the system pairs active drones within their level bracket (1-5, 6-10, 11-15, 16-20) using ELO ratings. Higher-rated drones face higher-rated opponents. If a bracket has an odd number of drones, a bot fills the gap to ensure everyone races.',
      },
      { type: 'subheading', text: 'Track Assignment' },
      {
        type: 'paragraph',
        text: 'Each race is assigned a track filtered by the drones\' level range. Tracks have minimum and maximum level requirements, difficulty ratings, and unique characteristics: different ratios of straights to turns, varying lengths, and signature conditions.',
      },
      { type: 'subheading', text: 'The Strategy Window' },
      {
        type: 'paragraph',
        text: 'When matchmaking completes, races enter a two-minute pending state before execution. During this window you see the upcoming matchup: your drone vs the opponent, the track layout, the rolled weather, and the time of day. This is the window where you swap the equipped mod on your drone to adapt to the matchup. When the timer expires the race locks and executes.',
      },
      {
        type: 'paragraph',
        text: 'You cannot change your active drone during a pending race. Activate or deactivate drones between race batches.',
      },
      { type: 'subheading', text: 'Race Simulation' },
      {
        type: 'paragraph',
        text: 'The race engine simulates each race segment by segment across 3 laps. Segments are either straights or turns, and different stats carry different weight on each type. Weather conditions (clear, rain, wind) and time of day (day, night) apply modifiers to relevant stats. Battery degrades across laps. Lap 1 runs clean, later laps test your Battery Capacity stat. The drone with the lowest total time wins.',
      },
      { type: 'subheading', text: 'Rewards and Progression' },
      {
        type: 'paragraph',
        text: 'Winners earn 10 XP plus volts (3 base + difficulty + upset bonus). Losers earn 4 XP plus a flat 2-volt participation payout. ELO ratings adjust based on the outcome. Upsets (a lower-rated drone beating a higher-rated one) flag in the log and pay a volts bonus to the winner. XP drives leveling, which unlocks higher stat caps and access to harder tracks. Volts fund the rest of the economy: stat upgrades, packs, and Marketplace buys. You cannot buy XP - leveling only happens by racing.',
      },
      { type: 'subheading', text: 'Active Drone Slots' },
      {
        type: 'paragraph',
        text: 'You start with 1 active drone slot. Slot 2 unlocks at 500 total races, slot 3 at 2,000 races. Only active drones enter race batches. Changes to active/inactive status take effect after the current race batch resolves.',
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
        text: 'Volts are the only in-game currency. You earn them by racing - winners take 3 base plus track and upset bonuses, losers take a flat 2. Volts buy stat upgrades, packs, and other players\' listings on the Marketplace.',
      },
      { type: 'subheading', text: 'The Marketplace' },
      {
        type: 'paragraph',
        text: 'The Marketplace is where players trade drones, skins, and mods with each other. All listings are priced in volts. A 5% rake is applied to every sale - the platform\'s only fee. Active drones can be listed and keep racing until they sell. A drone\'s entire bound skin and mod collection transfers with it.',
      },
      { type: 'subheading', text: 'Packs' },
      {
        type: 'paragraph',
        text: 'Two product lines: skin packs (cosmetics) and mod capsules (functional). Each comes in three tiers - Starter, Premium, and Legendary - with the same volt prices and the same slot rarity tables. Every pack opens 3 items.',
      },
      { type: 'subheading', text: 'Building value' },
      {
        type: 'paragraph',
        text: 'A drone\'s market value comes from the time invested in building it. Level, stat allocation, the bound skin and mod collection, and ELO history all contribute. Stat allocations are permanent - there is no respec. A well-built drone is what other players want to own.',
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Season 2 Preview - upcoming changes. Rendered at the end of the guide      */
/* with a distinct "Season 2 Preview" pill so users read it as a forward look */
/* rather than current mechanics.                                              */
/* -------------------------------------------------------------------------- */
const SEASON_2_PREVIEW = {
  id: 'season-2-preview',
  title: 'Season 2 Preview',
  Icon: Sparkles,
};

/** TOC entries: conceptual primers, deep-dives, then the Season 2 preview. */
const TOC_ENTRIES = [...PRE_SECTIONS, ...SECTIONS, SEASON_2_PREVIEW];

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
      },
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

  const activeSection =
    TOC_ENTRIES.find((s) => s.id === activeId) ?? TOC_ENTRIES[0];

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
              className={cn(
                styles.tocMobileChevron,
                mobileOpen && styles.tocMobileChevronOpen,
              )}
              aria-hidden="true"
            />
          </button>
          {mobileOpen && (
            <ul
              id="guide-toc-mobile-list"
              className={styles.tocMobileList}
            >
              {TOC_ENTRIES.map(({ id, title, Icon }) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    onClick={(e) => handleTocClick(e, id)}
                    className={cn(
                      styles.tocLink,
                      activeId === id && styles.tocLinkActive,
                    )}
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
                    className={cn(
                      styles.tocLink,
                      activeId === id && styles.tocLinkActive,
                    )}
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

            <section
              id={SEASON_2_PREVIEW.id}
              ref={(el) => {
                sectionRefs.current[SEASON_2_PREVIEW.id] = el;
              }}
              className={styles.s2Section}
            >
              <span className={styles.s2Pill}>Season 2 Preview</span>
              <Card className={styles.sectionCard}>
                <div className={styles.sectionHeading}>
                  <Sparkles size={14} aria-hidden="true" />
                  <span>What&apos;s Coming in Season 2</span>
                </div>
                <div className={styles.sectionBody}>
                  <p className={styles.paragraph}>
                    Season 2 introduces fixed supply, on-chain ownership, and a
                    new economic layer. Season 1 collections carry forward
                    intact and are flagged with a Season 1 badge.
                  </p>

                  <h3 className={styles.subheading}>Fixed Supply</h3>
                  <p className={styles.paragraph}>
                    Each legendary skin and mod has a fixed, limited supply.
                    Early Season 1 legendaries become the rarest items in the
                    game permanently.
                  </p>
                  <p className={styles.paragraph}>
                    Epic items have small defined supply caps. Rare and common
                    items have larger but still finite pools.
                  </p>

                  <h3 className={styles.subheading}>Pricing Reflects Scarcity</h3>
                  <p className={styles.paragraph}>
                    Legendary packs cost significantly more in Season 2 to
                    reflect true scarcity. Starter and Premium pricing follows.
                  </p>

                  <h3 className={styles.subheading}>On-Chain Assets</h3>
                  <p className={styles.paragraph}>
                    Drones, skins, and mods become on-chain assets (ERC-721) on
                    MegaETH. Ownership is verifiable and transferable.
                    Marketplace transactions settle on-chain with the same 5%
                    platform rake.
                  </p>

                  <h3 className={styles.subheading}>Season 1 Carryover</h3>
                  <p className={styles.paragraph}>
                    All Season 1 items carry forward to Season 2. Each carries
                    a Season 1 badge that stays with the item permanently.
                  </p>

                  <h3 className={styles.subheading}>Volts and $TOKEN</h3>
                  <p className={styles.paragraph}>
                    Volts gain a defined exchange rate with $TOKEN. Conversions
                    use cooldown periods and minimum thresholds to keep the
                    economy stable. Specific rates and timing are finalized
                    closer to launch.
                  </p>

                  <h3 className={styles.subheading}>Competitive Reset</h3>
                  <p className={styles.paragraph}>
                    ELO ratings and leaderboard positions reset at the start of
                    Season 2. Drone level, XP, stats, owned items, and wallet
                    balances all carry forward.
                  </p>
                </div>
              </Card>
            </section>
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
              <DroneImage
                drone={{ level: t.level }}
                alt={`Tier ${t.tier} drone`}
              />
            </div>
            <div
              className={cn(styles.tierLabel, styles[`tier_${t.color}`])}
            >
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
