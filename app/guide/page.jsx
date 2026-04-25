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
  ChevronDown,
} from 'lucide-react';
import NavShell from '@/components/ui/NavShell';
import Card from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import styles from './page.module.css';

const SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    Icon: Rocket,
    blocks: [
      { type: 'subheading', text: 'What is Drone Manager' },
      {
        type: 'paragraph',
        text: 'Passive competitive drone racing. You own drones, allocate stats, and they race automatically every 5 minutes. A weighted simulation decides each race using your stats vs. the opponent\'s, the track layout, the rolled weather, the time of day, and a small dampened random variance. Wins pay points and XP. Points spend on stat upgrades, marketplace buys, and packs. Seasons run 30 days.',
      },
      { type: 'subheading', text: 'Creating your account' },
      {
        type: 'paragraph',
        text: 'Sign up with email. We send a magic link. No password. On first sign-in you get a free Level 1 starter drone, your wallet starts at 0 points, your account starts at ELO 1000 with 1 active drone slot.',
      },
      { type: 'subheading', text: 'Your first drone' },
      {
        type: 'paragraph',
        text: 'Level 1, all 9 stats at 1, Total Stat Budget of 29, active by default. It enters the next race cycle automatically. The 9 stats sum to 9 already, so you have 20 points of TSB headroom to allocate as you earn. Every upgrade costs points from your wallet, so the first wins fund the first upgrades.',
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
        text: 'No single stat can exceed the cap for your level. Formula: cap = min(100, 10 + floor(4.5 * level)). Level 1: 14. Level 5: 32. Level 10: 55. Level 15: 77. Level 20: 100. The cap stops you from dumping every point into one stat early.',
      },

      { type: 'subheading', text: 'Stat upgrade costs' },
      {
        type: 'paragraph',
        text: 'Each upgrade point comes from your wallet. Cost depends on the stat\'s current value: 1 + floor(currentValue / 10). Costs scale in 10-point bands.',
      },
      {
        type: 'costTable',
        rows: [
          { range: 'Stat 1 -> 9', cost: '1 point per upgrade' },
          { range: 'Stat 10 -> 19', cost: '2 points per upgrade' },
          { range: 'Stat 20 -> 29', cost: '3 points per upgrade' },
          { range: 'Stat 30 -> 39', cost: '4 points per upgrade' },
          { range: 'Stat 40 -> 49', cost: '5 points per upgrade' },
          { range: 'Stat 50 -> 59', cost: '6 points per upgrade' },
          { range: 'Stat 60 -> 69', cost: '7 points per upgrade' },
          { range: 'Stat 70 -> 79', cost: '8 points per upgrade' },
          { range: 'Stat 80 -> 89', cost: '9 points per upgrade' },
          { range: 'Stat 90 -> 99', cost: '10 points per upgrade' },
        ],
      },
      {
        type: 'paragraph',
        text: 'Raising one stat from 1 to 100 costs 460 points total. The first 9 points are cheap. Past 50 it gets expensive fast.',
      },

      { type: 'subheading', text: 'No respec' },
      {
        type: 'paragraph',
        text: 'Stat allocations are permanent. Once a point is spent on a stat, it stays there.',
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
        text: 'Every 5 minutes the race cycle runs. All active drones get matched and raced. Result lands in your race log with the segment-by-segment data, the ELO change, the points payout, the XP, and the race conditions that rolled.',
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
        text: 'Difficulty drives the points payout. Winner gets a bonus of floor(difficulty / 2). Difficulty 1 pays +0. Difficulty 2-3 pays +1. Difficulty 4-5 pays +2. Difficulty 6-7 pays +3. Difficulty 8-9 pays +4. Difficulty 10 pays +5. The difficulty also signals layout intensity: more turns, longer length, tighter angles.',
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
          { name: 'Tempest Run', desc: '2 straights, 8 turns. Long. Difficulty 9. Levels 11-20. Top-bracket points. Tight, technical, battery-heavy.' },
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
          { name: '+20 points', desc: 'Paid into your wallet on every level-up. Spendable anywhere.' },
          { name: 'Possible tier change', desc: 'Levels 6, 11, and 16 cross a tier boundary, which changes the drone\'s appearance.' },
        ],
      },

      { type: 'subheading', text: 'Level cap' },
      {
        type: 'paragraph',
        text: 'Level 20 is the max. After that, XP gains stop counting toward level and the bar pins to full. ELO, points, season points, and skin progression keep going.',
      },

      { type: 'subheading', text: 'Drone tiers' },
      {
        type: 'paragraph',
        text: 'Tiers map directly to level brackets and drive the drone\'s base appearance.',
      },
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
        text: 'When a lower-rated drone beats a higher-rated one, the race is flagged UPSET in the log. The winner gets a points bonus on top of the base payout: floor((loserElo - winnerElo) / 100). 100 ELO underdog: +1 point. 250 underdog: +2. 500 underdog: +5.',
      },
    ],
  },

  {
    id: 'points-economy',
    title: 'Points and Economy',
    Icon: Coins,
    blocks: [
      {
        type: 'paragraph',
        text: 'Points are the only currency. One wallet per player, shared across all your drones.',
      },

      { type: 'subheading', text: 'Race rewards' },
      {
        type: 'paragraph',
        text: 'Winner payout = 3 base + floor(track difficulty / 2) + max(0, floor((loserElo - winnerElo) / 100)). Losers get 0 points (XP only).',
      },
      {
        type: 'list',
        items: [
          { name: 'Min payout', desc: '3 points. Difficulty-1 track, no upset.' },
          { name: 'Mid payout', desc: '5 points. Difficulty-5 track (+2), even matchup.' },
          { name: 'Strong payout', desc: '7 points. Difficulty-9 track (+4), even matchup.' },
          { name: 'Big upset', desc: '12 points. Difficulty-9 track (+4), 500 ELO underdog (+5).' },
        ],
      },

      { type: 'subheading', text: 'Other point income' },
      {
        type: 'list',
        items: [
          { name: 'Level-up bonus', desc: '+20 points per level. Paid into your wallet on the level-up.' },
          { name: 'Marketplace sale', desc: '95% of the sale price (5% platform fee).' },
        ],
      },

      { type: 'subheading', text: 'Where to spend' },
      {
        type: 'list',
        items: [
          { name: 'Stat upgrades', desc: 'Permanent. Cost depends on the stat\'s current value.' },
          { name: 'Marketplace', desc: 'Drones and unbound skins listed by other players.' },
          { name: 'Packs', desc: 'Starter (500), Premium (2,000), Legendary (10,000). 3 skins per pack.' },
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
        text: 'Buy and sell drones and skins from other players. Listings are visible to everyone.',
      },

      { type: 'subheading', text: 'Rules' },
      {
        type: 'list',
        items: [
          { name: 'Platform fee', desc: '5% of the sale price. The seller gets the remaining 95%.' },
          { name: 'Minimum listing price', desc: '10 points. Below that, the listing is rejected.' },
          { name: 'Active drones', desc: 'You can list a drone while it\'s racing. Listing doesn\'t deactivate it. The drone keeps racing for you until it sells.' },
          { name: 'Drone transfer', desc: 'A purchased drone arrives with its level, XP, full stat sheet, ELO rating, race history, and any applied skins intact.' },
          { name: 'Bound skins', desc: 'A skin applied to a drone transfers with the drone. It can\'t be sold separately once applied.' },
          { name: 'Unbound skins', desc: 'Skins you own but haven\'t applied can be listed and sold on their own.' },
          { name: 'Cancel anytime', desc: 'Cancel your own listing before it sells. The drone or skin returns to your inventory.' },
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

      { type: 'subheading', text: 'Applying a skin' },
      {
        type: 'paragraph',
        text: 'Permanent. Once applied, a skin is bound to that drone. It can\'t be removed, swapped, or sold separately. It transfers with the drone if you sell it.',
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
        text: 'Three pack tiers, all paid from your wallet. Each pack opens 3 skins drawn from the unowned skin vault. Each slot has a guaranteed minimum rarity or a probability table.',
      },

      { type: 'subheading', text: 'Starter Pack - 500 points' },
      {
        type: 'list',
        items: [
          { name: 'Slot 1', desc: 'Common (guaranteed).' },
          { name: 'Slot 2', desc: 'Common (guaranteed).' },
          { name: 'Slot 3', desc: 'Rare 70% / Epic 25% / Legendary 5%.' },
        ],
      },

      { type: 'subheading', text: 'Premium Pack - 2,000 points' },
      {
        type: 'list',
        items: [
          { name: 'Slot 1', desc: 'Rare (guaranteed).' },
          { name: 'Slot 2', desc: 'Epic 60% / Legendary 40%.' },
          { name: 'Slot 3', desc: 'Common 40% / Rare 35% / Epic 20% / Legendary 5%.' },
        ],
      },

      { type: 'subheading', text: 'Legendary Pack - 10,000 points' },
      {
        type: 'list',
        items: [
          { name: 'Slot 1', desc: 'Epic (guaranteed).' },
          { name: 'Slot 2', desc: 'Legendary (guaranteed).' },
          { name: 'Slot 3', desc: 'Rare 30% / Epic 50% / Legendary 20%.' },
        ],
      },

      { type: 'subheading', text: 'Vault rules' },
      {
        type: 'paragraph',
        text: 'Skins in a pack come from the public unowned vault. If the vault runs out of a rarity at open time, the pack open is rejected and your wallet isn\'t charged.',
      },
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
          { name: 'Season points', desc: 'Reset to 0 at season-end.' },
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
          { name: 'Points wallet', desc: 'Permanent.' },
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
  { name: 'Aero Shell',    bonus: '+5% Speed (straights)',       tradeoff: '-3% Turning' },
  { name: 'Grip Coating',  bonus: '+4% Turning',                 tradeoff: '-2% Acceleration' },
  { name: 'Night Optics',  bonus: '+8% Night Vision',            tradeoff: '-3% Battery Capacity' },
  { name: 'Storm Plating', bonus: '+6% Rain Handling',           tradeoff: '-4% Speed' },
  { name: 'Plasma Core',   bonus: '+5% Acceleration',            tradeoff: '-3% Consistency' },
  { name: 'Phantom Drive', bonus: 'Ignores Lap 1 battery drain', tradeoff: '-5% Wind Resistance' },
];

const SEASON_2_PREVIEW = {
  id: 'season-2-preview',
  title: 'Season 2 Preview',
  Icon: Sparkles,
};

/** TOC entries: the Season 2 preview block sits above the regular SECTIONS. */
const TOC_ENTRIES = [SEASON_2_PREVIEW, ...SECTIONS];

export default function GuidePage() {
  const [activeId, setActiveId] = useState(SEASON_2_PREVIEW.id);
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
    const el = sectionRefs.current[id];
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 24;
    window.scrollTo({ top, behavior: 'smooth' });
    setActiveId(id);
    setMobileOpen(false);
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
                  <h3 className={styles.subheading}>Trait Mods</h3>
                  <p className={styles.paragraph}>
                    Mods are equippable drone modifications that directly impact race outcomes. Skins are permanent visual reskins for your drone. Mods are strategic hardware. Each Mod offers a tradeoff: boost one stat at the cost of another. There are no pure power upgrades, only build diversity.
                  </p>

                  <h3 className={styles.subheading}>Pre-Race Strategy Window</h3>
                  <p className={styles.paragraph}>
                    When a race batch is pending, you&apos;ll see your opponents, the track, and the conditions before the race locks. You&apos;ll have a two-minute window to equip or swap your Mods. Study their build. Read the weather. Adapt your loadout. When the timer hits zero, your configuration locks and the race runs. Commit to your strategy or miss your chance.
                  </p>

                  <h3 className={styles.subheading}>Mod Rarity</h3>
                  <p className={styles.paragraph}>
                    Common Mods offer subtle adjustments. Small bonus, small penalty. Rare and Epic Mods push harder in both directions, creating sharper tradeoffs and more specialized builds. Legendary Mods break conventional rules entirely with unique mechanics that change how your drone behaves during a race.
                  </p>

                  <h3 className={styles.subheading}>Skins vs Mods</h3>
                  <p className={styles.paragraph}>
                    Skins are cosmetic. They permanently reskin your drone&apos;s appearance and are bound on equip. You buy them on the Marketplace or pull them from Packs. They look different but change nothing about race performance.
                  </p>
                  <p className={styles.paragraph}>
                    Mods are functional. They modify your drone&apos;s racing characteristics and can be swapped between races during the strategy window. They are tradeable on the Marketplace and will have their own Mod Packs.
                  </p>

                  <h3 className={styles.subheading}>Mod Examples</h3>
                  <div
                    className={cn(styles.costTable, styles.modTable)}
                    role="table"
                  >
                    <div className={styles.costHeader} role="row">
                      <span role="columnheader">Mod Name</span>
                      <span role="columnheader">Bonus</span>
                      <span role="columnheader">Tradeoff</span>
                    </div>
                    {MOD_EXAMPLES.map((row, i) => (
                      <div key={i} className={styles.costRow} role="row">
                        <span role="cell">{row.name}</span>
                        <span role="cell">{row.bonus}</span>
                        <span role="cell">{row.tradeoff}</span>
                      </div>
                    ))}
                  </div>

                  <p className={styles.paragraph}>
                    Mods, Mod Packs, and the pre-race strategy window will launch with Season 2. The Marketplace will expand with a dedicated MODS tab alongside the existing Drones, Skins, and Packs tabs.
                  </p>
                </div>
              </Card>
            </section>

            {SECTIONS.map(({ id, title, Icon, blocks }) => (
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
  return null;
}
