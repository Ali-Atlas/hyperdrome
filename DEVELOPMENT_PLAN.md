# Drone Manager v2 — Development Plan & Claude Code Prompt Sequence

**Working Title:** Drone Manager (name TBD before public launch)
**Created:** 2026-04-13
**Stack:** Next.js 14 App Router, JavaScript (no TypeScript), CSS Modules + CSS Variables, Neon Postgres, NextAuth.js, Vercel
**Project Directory:** ~/dev/dronemanager-v2/

---

## AUTO-LOOP INSTRUCTIONS FOR CLAUDE CODE

This file is the master development plan. Each task below is numbered and has a checkbox. To build this project:

1. Read this entire file first to understand the full project context.
2. Find the first unchecked task (`[ ]`).
3. Execute that task completely, following all instructions and constraints.
4. When the task is done, mark it as complete by changing `[ ]` to `[x]`.
5. Run verification steps listed under that task.
6. If verification passes, move to the next unchecked task.
7. If verification fails, fix the issues before moving on.
8. Repeat until all tasks are complete.

**CRITICAL RULES:**
- Complete ONE task at a time. Do not skip ahead.
- After completing a task, re-read any "What Already Exists" sections in subsequent tasks — they reference prior work.
- This project uses PLAIN JAVASCRIPT. No TypeScript. All files use .js or .jsx extensions. No .ts or .tsx files anywhere.
- This project uses CSS MODULES for component styling and CSS VARIABLES for the design system. No Tailwind. No utility classes. Every component gets a co-located .module.css file.
- NEVER hardcode color, spacing, font, or size values in component styles. Always reference CSS variables defined in the global stylesheet.
- NEVER create one-off styled elements. Always use or extend shared components from components/ui/.
- All components must be responsive at 3 breakpoints: 1440px (desktop), 1024px (tablet), 375px (mobile).
- Run `npm run dev` after each task to verify the app compiles and renders correctly.
- Use JSDoc comments on all functions and component props for documentation since we don't have TypeScript.

---

## PART 1: COMPLETE GAME SPECIFICATION

### 1.1 Game Overview

Drone Manager is a competitive idle drone racing game. Players own drones, allocate stat points, and their drones automatically race against other drones of the same level every 2 minutes. Race outcomes are determined by a weighted simulation engine that considers drone stats, track characteristics, weather, and time of day. Players earn points from wins and spend them on stat upgrades and marketplace purchases.

### 1.2 Core Game Loop

1. Player signs up via email magic link (passwordless). Receives one free starter drone (all stats at 1, Level 1).
2. Player allocates available stat points on their drone.
3. Drone is set to "active" and enters the racing queue.
4. Every 2 minutes, active drones are matched against other drones in their level bracket.
5. Race simulation runs segment-by-segment, stats determine outcome with small random variance.
6. Winner earns points and XP. Loser earns XP only.
7. Player checks results, adjusts stat allocation, repeat.

### 1.3 Drone System

**Stats:** 9 traits, each on a 1-100 scale, all start at 1.
- Speed — performance on straight track segments
- Turning — performance on turn segments
- Acceleration — start speed and recovery after turns
- Durability — resistance to performance degradation over race length
- Night Vision — performance in night conditions
- Battery Capacity — sustained performance in longer tracks
- Rain Handling — performance in wet weather
- Wind Resistance — performance in high-wind conditions
- Consistency — reduces random variance in race outcomes (high consistency = more predictable results)

**Total Stat Budget (TSB):** Hard cap on sum of all 9 stat values. Formula: `9 + (20 * Level)`.
- Level 1: TSB 29 (20 allocatable above the base 9)
- Level 5: TSB 109
- Level 10: TSB 209
- Level 15: TSB 309
- Level 20: TSB 409

**Per-Stat Cap by Level:** Formula: `Math.min(100, 10 + Math.floor(4.5 * Level))`.
- Level 1: max 14 per stat
- Level 5: max 32
- Level 10: max 55
- Level 15: max 77
- Level 20: max 100

**Stat Upgrade Cost:** Escalating cost to raise a stat from X to X+1: `1 + Math.floor(X / 10)`.
- Stat 1-10: costs 1 point each (9 total for range)
- Stat 11-20: costs 2 each (20 total)
- Stat 21-30: costs 3 each (30 total)
- Stat 51-60: costs 6 each (60 total)
- Stat 91-100: costs 10 each (100 total)
- Total cost 1 to 100: 549 points

**No respec.** Stat allocations are permanent. This creates drone identity, marketplace diversity, and meaningful decision-making.

**Points belong to the drone.** The currently owning player decides how to allocate, but points and stat allocations transfer with the drone on sale. Unspent points transfer too.

### 1.4 Leveling

Automatic via XP from racing. Not purchasable. Formula for XP to next level: `300 * Level * Level`.

Progression timeline (assumes 720 races/day at 50% win rate, 10 XP/win, 4 XP/loss = 5,040 XP/day):
- Level 2: Day 0.2 (first session)
- Level 5: Day 3
- Level 7: Week 1
- Level 10: Week 3
- Level 13: Week 7
- Level 15: Month 2.5
- Level 18: Month 4
- Level 20: Month 5.7 (~6 months)

Each level-up grants: increased TSB (+20), increased per-stat cap, and may push drone into next matchmaking bracket.

### 1.5 Matchmaking

**Level brackets:** 1-5, 6-10, 11-15, 16-20, 20+.
**Within bracket:** ELO-based pairing for skill-matched races.
**Bot drones:** Fill gaps when not enough real drones exist in a bracket. Bots are visually indistinguishable from real drones (they have names, stats, skins). Bot density per bracket is configurable via admin panel. Bots scale down automatically as real drone population grows.
**Odd drone in bracket:** Gets a bye (no race that cycle), earns consolation XP (2 XP).
**Race format:** 1v1 only.

### 1.6 Race Engine

**Interval:** Every 2 minutes (configurable via admin panel).
**Track assignment:** Random from available tracks. Each track has attributes: straights (count), turns (count), length (short/medium/long), difficulty (1-5).
**Conditions:** Random weather (clear, clouds, rain, heavy_rain, wind, haze, fog) and time of day (dawn, day, dusk, night).

**Simulation model:** Track is broken into segments based on its straights/turns composition. For each segment, each drone gets a performance score calculated from relevant stats:
- Straight segments: Speed (40%), Acceleration (30%), Wind Resistance (15%), Consistency (15%)
- Turn segments: Turning (40%), Durability (25%), Acceleration (20%), Consistency (15%)
- Night modifier: Night Vision stat multiplies performance for all segments during night races
- Rain modifier: Rain Handling stat multiplies performance during rain/heavy_rain
- Wind modifier: Wind Resistance multiplies performance during wind conditions
- Battery factor: Battery Capacity determines performance degradation over longer tracks
- Random variance: +/-5% on each segment score, reduced by Consistency stat

Each segment produces a time for each drone. Total race time = sum of segment times. Lower total time wins.

**Rewards:**
- Winner: 3 points + bonus for track difficulty + bonus for beating higher-ELO opponent. 10 XP.
- Loser: 0 points. 4 XP.
- Points formula: `3 + track_difficulty + Math.max(0, Math.floor((opponent_elo - drone_elo) / 100))`

### 1.7 Active Drone Slots

- New account: 1 active slot
- Milestone 1 (500 total races across all drones): unlock slot 2
- Milestone 2 (2000 total races): unlock slot 3
- Max 3 active drones simultaneously
- Players can own unlimited drones in their garage, but only active drones race.

### 1.8 Skins

**Purely cosmetic.** Zero gameplay impact.
**Player-owned inventory.** Skins belong to the player, not the drone. When a drone is sold, applied skins return to the player's inventory.
**Rarity tiers:** Common, Rare, Epic, Legendary.
**Visual effects by rarity:**
- Common: clean render, no effects
- Rare: subtle shimmer animation
- Epic: glow effect
- Legendary: particle effects

**Acquisition methods:**
- Marketplace purchase (individual skins at fixed prices)
- Skin packs (discounted bundles, known rarity distribution, e.g., "3 skins: 2 Common + 1 Rare or higher")
- Season rewards (exclusive skins for top leaderboard positions)
- Post-race random drops (small chance after any race, weighted by rarity)

### 1.9 Marketplace

**Two markets:** Drones tab and Skins tab.
**Currency:** Points (database-backed integer, no blockchain).
**Platform rake:** 5% on every transaction.
**Drone listings show:** Level, all 9 stats, unspent points, total races, win rate, ELO, price.
**Skin listings show:** Name, rarity tier, visual preview, price.
**Players can:** List items for sale, buy listed items, cancel their own listings.

### 1.10 Leaderboard

**Rankings by:** ELO rating, win rate, total wins, season points.
**Tabs:** Players and Drones (separate rankings).
**Seasons:** Configurable duration (default 30 days). Season end triggers reward distribution. Leaderboard resets for new season. Historical season data preserved.
**Season rewards:** Exclusive skins, point prizes, titles/badges.

### 1.11 Player Profiles

Viewable by other players. Shows: username, owned drones (with stats), race history, win rate, ELO, season rank, skin collection.

### 1.12 Authentication

- Email magic link (passwordless) via NextAuth.js Email provider
- Uses Resend (resend.com) as the email delivery service (free tier: 3000 emails/month)
- No passwords, no social OAuth
- Optional wallet connection stubbed for future MegaETH integration
- Session-based auth (JWT strategy)

### 1.13 Admin Panel

Basic MVP admin screen. Configurable values:
- Race interval (default 2 minutes)
- Points per win base (default 3)
- XP per win (default 10), XP per loss (default 4)
- TSB formula multiplier (default 20)
- Per-stat cap formula values
- Stat upgrade cost curve multiplier
- Level bracket boundaries
- Marketplace fee percentage (default 5%)
- Season duration (default 30 days)
- Bot drone density per bracket
- Skin drop rates by rarity

### 1.14 Revenue Model (Post-MVP, for reference)

- 5% marketplace rake
- Seasonal battle pass ($5-10, cosmetic rewards)
- Direct cosmetic purchases
- Tournament entry fee rake (10-15%)
- Founder NFT collection (separate from game)
- NO pay-to-win mechanics

### 1.15 Screens

6 player-facing screens + 1 admin screen:
1. Landing page — marketing, SEO-optimized, static content
2. Dashboard — player's command center, active drone, race feed, quick stats
3. Drone Management — stat editor, performance summary, race history
4. Race Results — filterable table of all races, live indicator
5. Leaderboard — podium, rankings, season info, rewards preview
6. Marketplace — drone and skin browsing, filters, buy/sell flow
7. Admin Panel — game parameter configuration

---

## PART 2: DESIGN SYSTEM SPECIFICATION

The entire design system lives in CSS variables declared in `app/globals.css`. Every component's `.module.css` file references these variables. No values are ever hardcoded in component styles.

### 2.1 CSS Variables — Colors

```css
:root {
  /* Backgrounds */
  --bg-primary: #000000;
  --bg-secondary: #0A0A0A;
  --bg-card: #121212;
  --bg-card-alt: #1A1A1A;
  --bg-elevated: #1E1E1E;
  --bg-input: #1E1E1E;

  /* Borders */
  --border-default: #1E1E1E;
  --border-subtle: #292929;
  --border-accent: #03DAC6;

  /* Accent Colors */
  --accent-primary: #03DAC6;
  --accent-secondary: #BB86FC;
  --accent-error: #CF6679;
  --accent-success: #03DAC6;

  /* Rarity Colors */
  --rarity-common: #9E9E9E;
  --rarity-rare: #03DAC6;
  --rarity-epic: #BB86FC;
  --rarity-legendary: #FFD700;

  /* Leaderboard Podium */
  --podium-gold: #FFD700;
  --podium-silver: #C0C0C0;
  --podium-bronze: #CD7F32;

  /* Text */
  --text-primary: #FFFFFF;
  --text-secondary: #A0A0A0;
  --text-tertiary: #666666;
  --text-accent: #03DAC6;
}
```

### 2.2 CSS Variables — Typography

```css
:root {
  /* Font Families */
  --font-heading: 'Rajdhani', sans-serif;
  --font-body: 'Inter', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* Font Sizes */
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 1.875rem;
  --text-4xl: 2.25rem;
  --text-5xl: 3rem;
  --text-6xl: 3.75rem;

  /* Font Weights */
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;
}
```

### 2.3 CSS Variables — Spacing, Radius, Shadows, Animations

```css
:root {
  /* Spacing (reference scale, use in component CSS) */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
  --space-16: 4rem;
  --space-20: 5rem;

  /* Border Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;

  /* Shadows */
  --shadow-card: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-elevated: 0 4px 16px rgba(0, 0, 0, 0.4);
  --glow-teal: 0 0 20px rgba(3, 218, 198, 0.15);
  --glow-purple: 0 0 20px rgba(187, 134, 252, 0.15);

  /* Animation */
  --duration-fast: 150ms;
  --duration-normal: 300ms;
  --duration-slow: 500ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
}

/* Keyframes */
@keyframes droneHover {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-4px); }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
```

### 2.4 Responsive Breakpoints

```css
/* Use in component .module.css files */
/* Mobile first: base styles are for 375px+ */
/* Tablet: @media (min-width: 768px) */
/* Small desktop: @media (min-width: 1024px) */
/* Desktop: @media (min-width: 1440px) */
```

### 2.5 Component Style Patterns

Every component follows this CSS Module pattern:

```
components/ui/Button/
  index.jsx        — Component logic
  Button.module.css — Component styles
```

All styles use CSS variables. Example pattern:

```css
/* Button.module.css */
.button {
  font-family: var(--font-body);
  font-weight: var(--font-semibold);
  border-radius: var(--radius-md);
  transition: all var(--duration-normal) var(--ease-out);
  cursor: pointer;
}

.primary {
  background: var(--accent-primary);
  color: #000000;
  border: none;
}

.primary:hover {
  filter: brightness(1.1);
  transform: scale(1.02);
}

.secondary {
  background: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
}

.secondary:hover {
  border-color: var(--accent-primary);
  color: var(--accent-primary);
}
```

---

## PART 3: DATABASE SCHEMA

### 3.1 Tables

```sql
-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  total_races INTEGER NOT NULL DEFAULT 0,
  total_wins INTEGER NOT NULL DEFAULT 0,
  elo_rating INTEGER NOT NULL DEFAULT 1000,
  season_points INTEGER NOT NULL DEFAULT 0,
  active_drone_slots INTEGER NOT NULL DEFAULT 1,
  image_url TEXT
);

-- NextAuth required tables (accounts, sessions, verification_tokens)
-- These are created by the NextAuth Drizzle adapter automatically.
-- We also need:

CREATE TABLE verification_token (
  identifier TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires TIMESTAMPTZ NOT NULL
);

-- Drones
CREATE TABLE drones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(100) NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  xp_to_next_level INTEGER NOT NULL DEFAULT 300,
  total_stat_budget INTEGER NOT NULL DEFAULT 29,
  unspent_points INTEGER NOT NULL DEFAULT 20,
  speed INTEGER NOT NULL DEFAULT 1,
  turning INTEGER NOT NULL DEFAULT 1,
  acceleration INTEGER NOT NULL DEFAULT 1,
  durability INTEGER NOT NULL DEFAULT 1,
  night_vision INTEGER NOT NULL DEFAULT 1,
  battery_capacity INTEGER NOT NULL DEFAULT 1,
  rain_handling INTEGER NOT NULL DEFAULT 1,
  wind_resistance INTEGER NOT NULL DEFAULT 1,
  consistency INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT false,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  total_races INTEGER NOT NULL DEFAULT 0,
  image_url TEXT NOT NULL DEFAULT '/drones/default.png',
  is_bot BOOLEAN NOT NULL DEFAULT false,
  applied_skin_id UUID REFERENCES skins(id) ON DELETE SET NULL
);

-- Tracks
CREATE TABLE tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  straights INTEGER NOT NULL,
  turns INTEGER NOT NULL,
  length VARCHAR(10) NOT NULL CHECK (length IN ('short', 'medium', 'long')),
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  image_url TEXT NOT NULL
);

-- Races
CREATE TABLE races (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  drone1_id UUID NOT NULL REFERENCES drones(id),
  drone2_id UUID NOT NULL REFERENCES drones(id),
  track_id UUID NOT NULL REFERENCES tracks(id),
  winner_drone_id UUID REFERENCES drones(id),
  points_awarded INTEGER NOT NULL DEFAULT 0,
  xp_winner INTEGER NOT NULL DEFAULT 10,
  xp_loser INTEGER NOT NULL DEFAULT 4,
  time_of_day VARCHAR(10) NOT NULL CHECK (time_of_day IN ('dawn', 'day', 'dusk', 'night')),
  weather VARCHAR(15) NOT NULL CHECK (weather IN ('clear', 'clouds', 'rain', 'heavy_rain', 'wind', 'haze', 'fog')),
  drone1_time DECIMAL(10,4),
  drone2_time DECIMAL(10,4),
  race_log JSONB
);

-- Skins
CREATE TABLE skins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(100) NOT NULL,
  rarity VARCHAR(15) NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
  image_url TEXT NOT NULL,
  description TEXT
);

-- Marketplace Listings
CREATE TABLE marketplace_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seller_id UUID NOT NULL REFERENCES users(id),
  item_type VARCHAR(10) NOT NULL CHECK (item_type IN ('drone', 'skin')),
  drone_id UUID REFERENCES drones(id),
  skin_id UUID REFERENCES skins(id),
  price INTEGER NOT NULL CHECK (price > 0),
  status VARCHAR(15) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled')),
  buyer_id UUID REFERENCES users(id),
  sold_at TIMESTAMPTZ,
  platform_fee INTEGER
);

-- Drone Ownership History
CREATE TABLE drone_ownership_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drone_id UUID NOT NULL REFERENCES drones(id),
  owner_user_id UUID REFERENCES users(id),
  start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date TIMESTAMPTZ,
  transaction_type VARCHAR(20) CHECK (transaction_type IN ('creation', 'purchase', 'transfer')),
  price_paid INTEGER
);

-- Seasons
CREATE TABLE seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_number INTEGER NOT NULL UNIQUE,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false
);

-- Admin Config (key-value store for tunable game parameters)
CREATE TABLE admin_config (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_drones_user_id ON drones(user_id);
CREATE INDEX idx_drones_level ON drones(level);
CREATE INDEX idx_drones_active ON drones(active);
CREATE INDEX idx_drones_is_bot ON drones(is_bot);
CREATE INDEX idx_races_drone1_id ON races(drone1_id);
CREATE INDEX idx_races_drone2_id ON races(drone2_id);
CREATE INDEX idx_races_created_at ON races(created_at DESC);
CREATE INDEX idx_races_winner_drone_id ON races(winner_drone_id);
CREATE INDEX idx_skins_user_id ON skins(user_id);
CREATE INDEX idx_skins_rarity ON skins(rarity);
CREATE INDEX idx_marketplace_status ON marketplace_listings(status);
CREATE INDEX idx_marketplace_item_type ON marketplace_listings(item_type);
CREATE INDEX idx_ownership_drone_id ON drone_ownership_history(drone_id);
```

### 3.2 Admin Config Seed Data

```sql
INSERT INTO admin_config (key, value, description) VALUES
('race_interval_seconds', '120', 'Seconds between race cycles'),
('points_per_win_base', '3', 'Base points awarded to race winner'),
('xp_per_win', '10', 'XP awarded to race winner'),
('xp_per_loss', '4', 'XP awarded to race loser'),
('xp_per_bye', '2', 'XP awarded for matchmaking bye'),
('tsb_base', '9', 'Base TSB (sum of starting stats)'),
('tsb_per_level', '20', 'Additional TSB granted per level'),
('stat_cap_base', '10', 'Base per-stat cap'),
('stat_cap_per_level', '4.5', 'Additional per-stat cap per level'),
('xp_curve_multiplier', '300', 'XP to next level = multiplier * level^2'),
('marketplace_fee_percent', '5', 'Platform fee on marketplace transactions'),
('season_duration_days', '30', 'Default season length in days'),
('bot_density_minimum', '4', 'Minimum bots per bracket to ensure matchmaking'),
('skin_drop_rate_common', '0.05', 'Chance of common skin drop per race'),
('skin_drop_rate_rare', '0.02', 'Chance of rare skin drop per race'),
('skin_drop_rate_epic', '0.005', 'Chance of epic skin drop per race'),
('skin_drop_rate_legendary', '0.001', 'Chance of legendary skin drop per race'),
('slot_2_unlock_races', '500', 'Total races to unlock active slot 2'),
('slot_3_unlock_races', '2000', 'Total races to unlock active slot 3');
```

---

## PART 4: PROMPT SEQUENCE

Each prompt below is a complete Claude Code task. Execute them in order.

---

### [x] TASK 0.1 — Project Scaffolding

> **Completion note (2026-04-13):** `create-next-app@latest` installed **Next.js 16.2.3** (not 14 as the plan specified). Next 16 works for the project but has breaking changes that later tasks must honour:
> - `middleware.js` is deprecated → use `proxy.js` with `export function proxy(...)`. Affects TASK 3.1.
> - `params` and `searchParams` are now **Promises** — every dynamic route/layout/route-handler must `await` them (e.g. `const { droneId } = await params`). Affects TASKS 3.2, 3.3, 3.4, 4.2, 4.4, 4.6.
> - `cookies()`, `headers()`, `draftMode()` from `next/headers` are async — must be awaited.
> - Turbopack is the default bundler — `dev`/`build` need no flags.
> - Node.js 20.9+ required, React 19.2 in use.
> - The scaffolder additionally created `AGENTS.md` and `CLAUDE.md` at the project root carrying a "this is not the Next.js you know" warning.
>
> Everything else from the task spec shipped: no TypeScript, no Tailwind, CSS Modules + CSS variables, complete `globals.css` design system, full folder tree, placeholder pages/APIs/services, `.env.local` + `.env.example` + `drizzle.config.js`. `npm run build` compiles all 22 routes cleanly; `npm run dev` starts in ~270ms and serves `/`, `/dashboard`, `/races`, `/marketplace` with HTTP 200.

**Goal:** Create a new Next.js project with the correct folder structure, dependencies, and configuration. No TypeScript. No Tailwind. CSS Modules only. The app should compile and show a blank dark page.

**Instructions:**

```
Create a new Next.js 14 project with these exact steps:

1. Run: npx create-next-app@latest ~/dev/dronemanager-v2 --js --eslint --app --src-dir=false --import-alias="@/*"
   IMPORTANT: When prompted, say NO to TypeScript, NO to Tailwind. YES to ESLint, YES to App Router.

2. cd into ~/dev/dronemanager-v2

3. Remove any Tailwind references if they exist (tailwind.config.js, postcss.config.js tailwind directives in CSS). This project uses CSS Modules and CSS variables only.

4. Install dependencies:
   npm install @neondatabase/serverless drizzle-orm drizzle-kit next-auth@beta resend zod lucide-react clsx

5. Install dev dependencies:
   npm install -D dotenv

6. Create this folder structure. Every file listed here should be created. Placeholder files should contain a minimal valid export or component (e.g., a div with the page name):

   app/
     globals.css             (FULL design system CSS variables from DEVELOPMENT_PLAN.md Part 2 — all variables, all keyframes, Google Font imports, base html/body styles, scrollbar styling)
     layout.jsx              (root layout — imports globals.css, sets metadata, dark bg body, wraps children)
     page.jsx                (landing page placeholder)
     page.module.css         (landing page styles placeholder)
     dashboard/
       page.jsx              (placeholder: "Dashboard")
       page.module.css
     drones/
       page.jsx              (placeholder: "My Drones")
       page.module.css
       [droneId]/
         page.jsx            (placeholder: "Drone Detail")
         page.module.css
     races/
       page.jsx              (placeholder: "Race Results")
       page.module.css
       [raceId]/
         page.jsx            (placeholder: "Race Detail")
         page.module.css
     leaderboard/
       page.jsx              (placeholder: "Leaderboard")
       page.module.css
     marketplace/
       page.jsx              (placeholder: "Marketplace")
       page.module.css
     admin/
       page.jsx              (placeholder: "Admin Panel")
       page.module.css
     profile/
       [userId]/
         page.jsx            (placeholder: "Player Profile")
         page.module.css
     api/
       auth/
         [...nextauth]/
           route.js          (placeholder: export GET and POST as empty handlers)
       users/
         route.js            (placeholder)
       drones/
         route.js            (placeholder)
         [droneId]/
           route.js          (placeholder)
           allocate/
             route.js        (placeholder)
           toggle/
             route.js        (placeholder)
       races/
         route.js            (placeholder)
         [raceId]/
           route.js          (placeholder)
         run/
           route.js          (placeholder — this is the cron endpoint)
         next/
           route.js          (placeholder)
       marketplace/
         route.js            (placeholder)
         [listingId]/
           buy/
             route.js        (placeholder)
           cancel/
             route.js        (placeholder)
       leaderboard/
         route.js            (placeholder)
         me/
           route.js          (placeholder)
       skins/
         route.js            (placeholder)
         apply/
           route.js          (placeholder)
         remove/
           route.js          (placeholder)
       admin/
         config/
           route.js          (placeholder)

   components/
     ui/                     (empty dir — shared components built in Task 1.2)
     dashboard/              (empty dir)
     drones/                 (empty dir)
     races/                  (empty dir)
     leaderboard/            (empty dir)
     marketplace/            (empty dir)
     admin/                  (empty dir)

   lib/
     db/
       index.js              (Neon serverless connection — import { neon } from '@neondatabase/serverless', export sql function using DATABASE_URL)
       schema.js             (placeholder — Drizzle schema defined in Task 0.2)
       seed.js               (placeholder)
     auth/
       index.js              (placeholder for NextAuth config)
     game-engine/
       race-simulator.js     (placeholder)
       matchmaking.js        (placeholder)
       economy.js            (placeholder)
     validators/
       index.js              (placeholder)
     utils.js                (utility functions — cn() for merging classnames using clsx)

   services/
     user.service.js         (placeholder)
     drone.service.js        (placeholder)
     race.service.js         (placeholder)
     track.service.js        (placeholder)
     skin.service.js         (placeholder)
     marketplace.service.js  (placeholder)
     leaderboard.service.js  (placeholder)

   hooks/                    (empty dir)

   public/
     drones/                 (empty dir — drone images go here later)
     tracks/                 (empty dir — track images go here later)

   .env.local with these keys (empty values):
     DATABASE_URL=
     NEXTAUTH_URL=http://localhost:3000
     NEXTAUTH_SECRET=
     RESEND_API_KEY=

   .env.example with same keys and comments explaining each one.

   drizzle.config.js pointing to DATABASE_URL.

7. The globals.css must contain the COMPLETE design system from Part 2 of this plan:
   - Google Font imports (@import) for Rajdhani (400,500,600,700), Inter (400,500,600), JetBrains Mono (400,500)
   - All CSS variables from sections 2.1, 2.2, 2.3
   - All keyframe animations (droneHover, shimmer, pulse, fadeInUp)
   - Base styles: html { scroll-behavior: smooth; } body { background: var(--bg-primary); color: var(--text-primary); font-family: var(--font-body); -webkit-font-smoothing: antialiased; margin: 0; }
   - Dark scrollbar styles
   - A .visually-hidden utility class for accessibility
   - A @media (prefers-reduced-motion: reduce) block that disables animations

8. The root layout.jsx should:
   - Import globals.css
   - Set metadata: { title: 'Drone Manager', description: 'Competitive idle drone racing — build, optimize, and dominate the circuit.' }
   - Render children inside a body tag with dark background

9. Each placeholder page.jsx should be a simple component that renders a div with the page name in white text, centered, using var(--font-heading) and var(--text-2xl). This confirms routing and CSS variables work.

10. lib/utils.js should export:
    - cn(...classes) — uses clsx to merge classnames (import clsx from 'clsx')
```

**Verification:**
- `npm run dev` starts without errors
- Visiting localhost:3000 shows dark page with "Landing Page" text in the correct heading font
- Each route (/dashboard, /drones, /races, /leaderboard, /marketplace, /admin) shows its name
- Browser dev tools confirm Google Fonts loaded (Rajdhani, Inter, JetBrains Mono visible in Network tab)
- CSS variables work (inspect an element, confirm var(--accent-primary) resolves to #03DAC6)
- No .ts or .tsx files exist anywhere in the project
- No tailwind.config.js exists, no Tailwind directives in any CSS file

---

### [x] TASK 0.2 — Database Schema & Seed Data

> **Completion note (2026-04-13):** Schema pushed to Neon via `drizzle-kit push` (9 tables: `users`, `verification_token`, `skins`, `drones`, `tracks`, `races`, `marketplace_listings`, `drone_ownership_history`, `seasons`, `admin_config` — plus all indexes from Part 3). Seed inserted 7 tracks, 19 admin_config rows, 1 active season, 20 bot drones, 56 skins (30 common / 15 rare / 8 epic / 3 legendary). Bot stat sums verified to exactly match their level's TSB with all stats under the per-stat cap.
>
> Deviations / additions from the task spec:
> - Added `"type": "module"` to `package.json` and a `db:push` / `db:studio` npm script alongside `seed`.
> - `drizzle.config.js` now loads `.env.local` itself via `dotenv.config({ path: '.env.local' })` so `drizzle-kit` CLI invocations pick up the connection string without a wrapper.
> - `lib/db/index.js` exports both `sql` (raw Neon) and `db` (Drizzle) — lazily initialised so importing with an empty `DATABASE_URL` doesn't throw.
> - CHECK constraints from the plan's SQL (weather enum, rarity enum, status enum, etc.) are enforced at the app layer via Zod in TASK 2.1 rather than at the DB level — this keeps the schema file portable and avoids drizzle-kit CHECK support edge cases.
> - NextAuth adapter tables (`accounts`, `sessions`) are NOT yet created — they'll land in TASK 3.1 when `@auth/drizzle-adapter` is installed. `verification_token` is already in place.
> - Seed script is idempotent: each section checks for existing rows and skips if already populated, so re-running `npm run seed` is safe.

**Goal:** Set up the complete database schema using Drizzle ORM with Neon, run migrations, and seed with test data.

**What Already Exists:** Project scaffolding from Task 0.1. Neon connection in lib/db/index.js.

**Instructions:**

```
Set up the complete database schema and seed data for Drone Manager.

1. Define the full Drizzle ORM schema in lib/db/schema.js matching the SQL in DEVELOPMENT_PLAN.md Part 3.
   Use Drizzle's pgTable definitions. Export all table definitions.
   Use JSDoc comments to document each table and its columns.

2. Update drizzle.config.js:
   - dialect: 'postgresql'
   - schema: './lib/db/schema.js'
   - dbCredentials: { url: process.env.DATABASE_URL }

3. Update lib/db/index.js:
   - Import { neon } from '@neondatabase/serverless'
   - Import { drizzle } from 'drizzle-orm/neon-http'
   - Import * as schema from './schema.js'
   - Create and export the drizzle db instance with the schema
   - Also export raw sql function for complex queries

4. Run schema push: npx drizzle-kit push
   (This creates all tables directly in the Neon database)

5. Create lib/db/seed.js that:
   - Connects to Neon
   - Inserts 7 tracks with varied characteristics:
     Track 1: "Neon Straightaway" - 8 straights, 2 turns, short, difficulty 1
     Track 2: "Circuit Alpha" - 5 straights, 5 turns, medium, difficulty 2
     Track 3: "Skyline Drift" - 3 straights, 7 turns, medium, difficulty 3
     Track 4: "Voltage Loop" - 4 straights, 8 turns, long, difficulty 4
     Track 5: "The Grid" - 6 straights, 4 turns, short, difficulty 2
     Track 6: "Tempest Run" - 2 straights, 8 turns, long, difficulty 5
     Track 7: "Horizon Express" - 9 straights, 1 turn, medium, difficulty 1
   - Inserts all admin_config values from Part 3.2
   - Inserts 20 bot drones spread across levels 1-10:
     - Use names like "PHANTOM-X1", "SHADOW-R3", "VIPER-K7", "ECHO-M4", "PULSE-D9", etc.
     - Stats should be reasonable for their level (allocated within TSB, not random garbage)
     - Set is_bot = true, active = true
     - Spread across level brackets: 10 bots in 1-5, 10 bots in 6-10
   - Inserts skins: 30 common, 15 rare, 8 epic, 3 legendary
     - Thematic names: "Carbon Fiber", "Neon Pulse", "Shadow Walker", "Gold Circuit", etc.
     - Common: industrial/basic names. Rare: tech names. Epic: elemental names. Legendary: mythical names.
     - user_id = null (unowned, available for drops/marketplace seeding)
     - Placeholder image_url values ("/skins/common_01.png" pattern)
   - Inserts 1 active season: Season 1, started today, ends in 30 days

6. Add to package.json scripts: "seed": "node --env-file=.env.local lib/db/seed.js"
   (using Node's built-in --env-file flag to load env vars)

7. Run the seed: npm run seed
```

**Verification:**
- `npx drizzle-kit push` succeeds
- `npm run seed` completes without errors
- Check Neon dashboard: all tables exist with correct columns
- Tables contain seeded data: 7 tracks, 19 admin config rows, 20 bot drones, 56 skins, 1 season
- Bot drone stats make sense for their levels (within TSB, within per-stat caps)

---

### [x] TASK 1.1 — Global Styles Refinement

> **Completion note (2026-04-13):** Audit-only. `app/globals.css` was already written in TASK 0.1 with the full design system (all color/font/spacing/radius/shadow/animation variables, all four keyframes, Google Fonts with `display=swap`, dark scrollbar styling, teal `::selection` at 30% opacity, `.visually-hidden` utility, focus-pattern documentation comment, `prefers-reduced-motion` block, and base body with `min-height: 100vh` + `overflow-x: hidden` + `line-height: 1.6`). Checked against the 1.1 instructions — every item is present. No changes required.

**Goal:** Verify the global CSS design system is complete and add any shared style patterns needed before building components.

**What Already Exists:** Project scaffolding with globals.css from Task 0.1.

**Instructions:**

```
Audit and complete the global stylesheet at app/globals.css.

1. Verify ALL CSS variables from DEVELOPMENT_PLAN.md Part 2 are present. Add any that are missing.

2. Verify Google Font imports load correctly for:
   - Rajdhani (400, 500, 600, 700)
   - Inter (400, 500, 600)
   - JetBrains Mono (400, 500)

3. Add these global utility patterns (not as classes to apply — as documented patterns for component CSS to follow):

   /* Focus ring for accessibility — all interactive elements should use this */
   Add a comment block documenting the focus pattern:
   outline: 2px solid var(--accent-primary);
   outline-offset: 2px;

4. Ensure the dark scrollbar styling covers:
   - ::-webkit-scrollbar (width 8px)
   - ::-webkit-scrollbar-track (bg-secondary)
   - ::-webkit-scrollbar-thumb (border-subtle, rounded)
   - ::-webkit-scrollbar-thumb:hover (accent-primary)

5. Add a @media (prefers-reduced-motion: reduce) block that sets:
   *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }

6. Verify the base body styles include:
   - min-height: 100vh
   - overflow-x: hidden (prevent horizontal scroll)
   - line-height: 1.6

7. Add a selection style (::selection) with teal background at 30% opacity.

8. Test by viewing the app — fonts should load without layout shift (use font-display: swap in the Google Fonts import URL parameters).
```

**Verification:**
- All 3 fonts load correctly in browser
- CSS variables resolve to correct values
- Scrollbar is styled dark
- No horizontal overflow on any page
- Text selection shows teal highlight

---

### [x] TASK 1.2 — Shared UI Component Library

> **Completion note (2026-04-13):** All 14 components built under `components/ui/` — each a folder with `index.jsx` + `ComponentName.module.css`: Button, Card, StatBar, Badge, Toggle, DataTable, FilterBar, CountdownTimer, StatEditorRow, NavShell, Skeleton, EmptyState, Modal, Toast. Barrel `components/ui/index.js` re-exports them all. Every component uses CSS Modules referencing only CSS variables — no hardcoded colours/spacing/fonts. Interactive components (`'use client'`): Toggle, DataTable, FilterBar, CountdownTimer, StatEditorRow, NavShell, Modal, Toast. Toggle/Modal are keyboard-accessible (Space/Enter/Escape). Toast exposes `ToastProvider` + `useToast()` context. Verified via a temporary `app/test/page.jsx` that imported and rendered every component — `npm run build` compiled 23 routes cleanly, then the test page was deleted.
>
> Two things worth flagging for later tasks:
> - `StatBar` auto-omits the label column when `label` is empty/null — `StatEditorRow` relies on this.
> - `Card` upgrades to a `<button>` when an `onClick` prop is passed (a11y + keyboard focus), otherwise stays a `<div>`.

**Goal:** Build all shared UI components using CSS Modules. These are used across every screen.

**What Already Exists:** Project scaffolding, complete CSS variable system.

**Instructions:**

```
Build the shared UI component library in components/ui/. Each component is a folder containing index.jsx and ComponentName.module.css. Every component must:
- Be a plain JavaScript React component (no TypeScript)
- Use JSDoc comments for prop documentation
- Use CSS Modules for all styling (import styles from './ComponentName.module.css')
- Reference ONLY CSS variables for colors, fonts, spacing, radius, shadows — never hardcode values
- Support a className prop that gets merged with internal classes using the cn() utility from lib/utils.js

Create these components:

1. components/ui/Button/index.jsx + Button.module.css
   Props (documented via JSDoc):
   - variant: 'primary' | 'secondary' | 'danger' | 'ghost' (default: 'primary')
   - size: 'sm' | 'md' | 'lg' (default: 'md')
   - disabled: boolean
   - loading: boolean (shows a CSS spinner, disables interaction)
   - className: string
   - ...rest (spread to native button)
   Styles: primary = teal bg + black text. secondary = transparent + border + white text. See Part 2.5.
   Hover, focus (teal outline), active (scale 0.98), disabled (opacity 0.5) states.

2. components/ui/Card/index.jsx + Card.module.css
   Props: className, children, hover (boolean — enables glow on hover), onClick
   Styles: bg-card, border-default, radius-lg, shadow-card. Hover: border-accent + glow-teal + scale(1.02).

3. components/ui/StatBar/index.jsx + StatBar.module.css
   Props: value (number), maxValue (number), label (string), size ('sm' | 'md')
   Renders: label text, a track div with a fill div inside (width proportional to value/maxValue), numeric value in mono font.
   Fill color: accent-primary.

4. components/ui/Badge/index.jsx + Badge.module.css
   Props: variant ('rarity' | 'status' | 'level'), value (string), className
   For rarity variant: value is 'common'|'rare'|'epic'|'legendary'. Background is the rarity color at 15% opacity, text is full rarity color.
   For status: 'active' (teal) or 'inactive' (gray).
   For level: shows "Lvl {value}" with accent-primary color.
   All badges: mono font, text-xs, uppercase, radius-sm, inline-flex.

5. components/ui/Toggle/index.jsx + Toggle.module.css
   Props: checked (boolean), onChange (function), disabled (boolean), label (string)
   Renders: a label with text, a toggle track (40px wide, 22px tall, rounded-full), a knob (18px circle) that slides left/right.
   On state: track bg accent-primary, knob right. Off state: track bg bg-elevated, knob left.
   Smooth transition. Keyboard accessible (space/enter to toggle). Focus ring.

6. components/ui/DataTable/index.jsx + DataTable.module.css
   Props:
   - columns: array of { key, label, sortable (boolean), render (optional function), align ('left'|'center'|'right') }
   - data: array of row objects
   - onRowClick: function(row) — optional, makes rows clickable
   - sortable: boolean (enables column header sort clicks)
   - loading: boolean (shows skeleton rows)
   - emptyMessage: string
   - className
   Features:
   - Column headers in text-secondary, uppercase, mono font, text-xs
   - Alternating row backgrounds (bg-card / bg-card-alt)
   - Sort indicator arrows on sortable columns (chevron up/down from lucide-react)
   - Row hover: bg-elevated
   - If onRowClick: cursor pointer on rows
   - Loading: render 5 skeleton rows with shimmer animation
   - Empty: render centered emptyMessage
   - Responsive: wrap in a horizontal-scroll container

7. components/ui/FilterBar/index.jsx + FilterBar.module.css
   Props:
   - filters: array of { key, label, type ('select'|'range'), options (for select) }
   - values: object of current filter values
   - onChange: function(key, value)
   - onSearch: function(searchTerm)
   - searchPlaceholder: string
   Features: row of filter dropdowns/inputs + search field. Wraps on mobile.
   Select inputs styled dark (bg-input, border-subtle, text-primary).

8. components/ui/CountdownTimer/index.jsx + CountdownTimer.module.css
   Props: targetDate (Date or ISO string), label (string)
   Renders: label text + "HH:MM:SS" in mono font, teal color, updates every second.
   When seconds change: subtle pulse animation on the seconds digits.
   When expired: shows "Racing now..." or similar.

9. components/ui/StatEditorRow/index.jsx + StatEditorRow.module.css
   Props: statName, currentValue, baseValue, maxValue, pointsAvailable, onIncrement, onDecrement, costToUpgrade
   Renders a single stat row for the drone management screen:
   - Stat label (font-body, font-medium)
   - Current numeric value (font-mono, large)
   - Minus button and Plus button
   - Visual bar (StatBar showing value relative to maxValue)
   - If currentValue > baseValue: show delta "baseValue → currentValue" with arrow in teal
   - Plus disabled when: currentValue >= maxValue OR pointsAvailable < costToUpgrade
   - Minus disabled when: currentValue <= baseValue
   - Show cost for next point: small text "(cost: {n})" near plus button
   Buttons styled: small squares, border-subtle, hover border-accent.

10. components/ui/NavShell/index.jsx + NavShell.module.css
    The main application layout shell with navigation.
    Props: children (page content), user (object with username, points — or null if not logged in)
    Desktop (>= 1024px): fixed left sidebar (240px wide) with:
      - "Drone Manager" logo/text at top
      - Nav links: Dashboard, My Drones, Races, Leaderboard, Marketplace (use lucide-react icons: LayoutDashboard, Cpu, Flag, Trophy, Store)
      - Active link: teal text + teal left border (3px)
      - Inactive: text-secondary
      - User info at bottom: username, points balance (mono font)
      - If not logged in: "Sign In" button
    Mobile (< 1024px): top bar (60px tall) with:
      - Hamburger icon (Menu from lucide-react) left
      - "Drone Manager" center
      - User points right
      - Clicking hamburger opens slide-out drawer from left with dark overlay
      - Drawer contains same nav links as sidebar
      - Clicking a link or the overlay closes the drawer
    Main content area: to the right of sidebar (desktop) or below top bar (mobile), with proper padding.
    Use Next.js usePathname() to determine active route.

11. components/ui/Skeleton/index.jsx + Skeleton.module.css
    Props: variant ('card' | 'table-row' | 'text' | 'stat-bar' | 'circle'), width, height, count (number of skeletons to render)
    Renders: divs with bg-elevated background and shimmer animation.
    Shapes match the variant (card = rounded rectangle, circle = round, etc.)

12. components/ui/EmptyState/index.jsx + EmptyState.module.css
    Props: title, description, actionLabel, onAction
    Renders: centered column with icon (lucide-react Inbox), title (text-xl, text-secondary), description (text-sm, text-tertiary), optional action button (primary).

13. components/ui/Modal/index.jsx + Modal.module.css
    Props: isOpen, onClose, title, children, size ('sm' | 'md' | 'lg')
    Renders: dark overlay (bg-primary at 80% opacity), centered card (bg-elevated, radius-lg, shadow-elevated).
    Close button (X icon) top right. Title in heading font.
    Keyboard: Escape closes. Click overlay closes. Focus trap inside modal.
    Sizes: sm = 400px max-width, md = 600px, lg = 800px. All responsive (max 90vw on mobile).

14. components/ui/Toast/index.jsx + Toast.module.css
    A toast notification system.
    Export a ToastProvider component that wraps the app and a useToast() hook.
    useToast() returns: { showToast(message, type) } where type is 'success' | 'error' | 'info'.
    Toasts appear top-right, stack vertically, auto-dismiss after 3 seconds.
    Colors: success = accent-primary border, error = accent-error border, info = border-subtle.
    Smooth enter (slide in from right) and exit (fade out) animations.

Create a components/ui/index.js barrel file that re-exports all components.
```

**Verification:**
- Every component renders without errors
- Create a temporary app/test/page.jsx that imports and displays every component with sample props
- Verify: dark backgrounds, teal accents, correct fonts, hover states, responsive behavior
- Toggle, modal, and toast are keyboard-accessible
- Delete the test page after verification

---

### [x] TASK 2.1 — Validation Schemas & Game Economy Functions

> **Completion note (2026-04-13):** `lib/validators/index.js` exports six Zod schemas (`allocateStatsSchema`, `toggleDroneSchema`, `createListingSchema`, `buyListingSchema`, `updateAdminConfigSchema`, `paginationSchema`). Uses Zod v4 `z.uuid()` and `z.coerce.number()` patterns. `lib/game-engine/economy.js` exports nine pure functions (cost, total cost, TSB, per-stat cap, XP curve, race points, ELO update, stat-allocation validator, performance analyser) — all accept a `config` object so the same math runs client and server-side. `validateStatAllocation` and `analyzeDronePerformance` accept both snake_case and camelCase stat keys. Test script `lib/game-engine/economy.test.js` runs 46 assertions (all pass) covering edge cases at levels 1/5/10/15/20, stat values 1/9/10/50/99, ELO symmetry, cost 1→100 = 549, and Zod happy/sad paths. `npm run test:economy` is wired up.

**Goal:** Define Zod validation schemas and pure game economy calculation functions. Since there's no TypeScript, these serve as the runtime contract between frontend and backend.

**What Already Exists:** Project scaffolding, database schema, UI components.

**Instructions:**

```
Create the validation and game math layer.

1. lib/validators/index.js — Zod schemas for every API request:

   - allocateStatsSchema: validates { drone_id (uuid string), stat_changes (object with optional keys for each of the 9 stats, each a positive integer) }
   - toggleDroneSchema: { drone_id (string), active (boolean) }
   - createListingSchema: { item_type ('drone'|'skin'), drone_id (optional string), skin_id (optional string), price (positive integer) }
   - buyListingSchema: { listing_id (string) }
   - updateAdminConfigSchema: { key (string), value (string) }
   - paginationSchema: { page (positive int, default 1), limit (positive int 1-100, default 20), sort_by (optional string), sort_order (optional 'asc'|'desc', default 'desc') }

   Each schema should have JSDoc explaining what it validates.

2. lib/game-engine/economy.js — Pure functions with NO database calls:

   /**
    * Cost to raise a stat from currentValue to currentValue + 1.
    * Formula: 1 + Math.floor(currentValue / 10)
    */
   function calculateStatUpgradeCost(currentValue) {}

   /**
    * Total cost to raise a stat from fromValue to toValue.
    * Sums individual upgrade costs for each point.
    */
   function calculateTotalUpgradeCost(fromValue, toValue) {}

   /**
    * Total Stat Budget for a given level.
    * Formula: tsbBase + (tsbPerLevel * level)
    * Accepts config params so it can run client-side with cached config.
    */
   function calculateTSB(level, config = { tsbBase: 9, tsbPerLevel: 20 }) {}

   /**
    * Maximum value any single stat can reach at a given level.
    * Formula: Math.min(100, statCapBase + Math.floor(statCapPerLevel * level))
    */
   function calculatePerStatCap(level, config = { statCapBase: 10, statCapPerLevel: 4.5 }) {}

   /**
    * XP required to advance from current level to next level.
    * Formula: xpMultiplier * level * level
    */
   function calculateXPToNextLevel(level, config = { xpMultiplier: 300 }) {}

   /**
    * Points awarded to race winner.
    * Formula: basePoints + trackDifficulty + max(0, floor((loserElo - winnerElo) / 100))
    */
   function calculateRacePoints(trackDifficulty, winnerElo, loserElo, config = { basePoints: 3 }) {}

   /**
    * ELO rating update after a race. Uses standard ELO formula with K-factor 32.
    * Returns { newWinnerElo, newLoserElo }
    */
   function calculateNewElo(winnerElo, loserElo, kFactor = 32) {}

   /**
    * Validates a proposed stat allocation against all game rules.
    * Checks: TSB not exceeded, per-stat caps respected, costs affordable, no stat decreased below base.
    * Returns { valid: boolean, errors: string[], totalCost: number }
    */
   function validateStatAllocation(drone, proposedStats, config) {}

   /**
    * Given a drone's stats, determine which conditions it performs best/worst in.
    * Returns { optimal: [...conditions], moderate: [...conditions], poor: [...conditions] }
    */
   function analyzeDronePerformance(droneStats) {}

   All functions must be exported. All must accept config parameters (not import from DB) so they work both server-side and client-side.

3. Create a simple test script at lib/game-engine/economy.test.js that:
   - Calls each function with sample inputs
   - Logs the results
   - Verifies basic sanity (e.g., TSB at level 1 = 29, upgrade cost at value 1 = 1, upgrade cost at value 50 = 6)
   - Add to package.json: "test:economy": "node lib/game-engine/economy.test.js"
```

**Verification:**
- `npm run test:economy` passes all sanity checks
- Zod schemas correctly reject invalid inputs (test manually in the test script)
- Economy functions return correct values for edge cases (level 1, level 20, stat 1, stat 100)

---

### [x] TASK 3.1 — Auth System (Email Magic Link)

> **Completion note (2026-04-13):** NextAuth v5 beta wired up with the Resend provider + Drizzle adapter. `lib/auth/index.js` exports `handlers`, `auth`, `signIn`, `signOut`. `app/api/auth/[...nextauth]/route.js` re-exports the handlers. JWT session strategy, `/login` + `/check-email` custom pages, `trustHost: true`, secret from `NEXTAUTH_SECRET`. `callbacks.jwt` looks up the user's username + points from the DB on first sign-in and stashes them in the token; `callbacks.session` exposes them as `session.user.{id,username,points}`. `events.createUser` backfills the generated username and creates a starter drone (random adjective+noun name, all stats at 1, 20 unspent points, active, `drone_ownership_history` row with `transaction_type = 'creation'`).
>
> **Schema additions pushed:** `accounts` table, `sessions` table, and three new columns on `users` (`name`, `emailVerified`, `image`) required by `@auth/drizzle-adapter`. The `username` column is now nullable because the adapter inserts the user row before our event fires; the event then updates the row with the generated username.
>
> **Deviations from plan spec that later tasks should know about:**
> - Installed `@auth/drizzle-adapter@^1.11.1` (the plan had this arriving here, not in 0.1).
> - Imported `DrizzleAdapter` (top-level auto-detect), not `PostgresDrizzleAdapter` — only `.` is exported from the package.
> - **Next.js 16 rename:** what the plan calls `middleware.js` is `proxy.js` with `export function proxy(...)`. Route protection lives in `/proxy.js` at the project root with `config.matcher` covering all private sections.
> - `hooks/useSession.js` wraps `next-auth/react` so components import from one place; it re-exports `SessionProvider` and a thin `useSession()` that returns `{ user, status, signIn, signOut }`.
> - `app/layout.jsx` now wraps `children` in `<SessionProvider>`.
> - `components/ui/NavShell` reads the session directly via `useSession()` — pages no longer need to pass a `user` prop.
> - Login page uses `signIn('resend', { email, redirectTo: '/dashboard' })`.
>
> **Smoke-tested:** `npm run dev` → `GET /login` 200 (renders "Send magic link"), `GET /check-email` 200 (renders "Check your email"), `GET /dashboard` (unauth) 307 → `/login?callbackUrl=/dashboard`, `GET /api/auth/providers` 200 returning `{"resend":{"id":"resend","name":"Resend","type":"email",...}}`.
>
> **Not tested end-to-end:** actual magic-link email delivery (would require Captain to enter their Resend-account email and click the link in their inbox). The Resend provider's `from` is `onboarding@resend.dev`, which works on the free tier only when sending to the Resend account owner's address.

**Goal:** Implement NextAuth with email magic link auth via Resend, user creation on first login, and starter drone generation.

**What Already Exists:** Project scaffolding, database, economy functions, UI components including NavShell.

**Instructions:**

```
Implement the complete email magic link authentication system.

1. lib/auth/index.js — NextAuth configuration:
   - Import NextAuth from 'next-auth'
   - Import Resend provider from 'next-auth/providers/resend' (or use the Email provider with Resend as transport)
   - Import DrizzleAdapter from '@auth/drizzle-adapter'
   - Configure:
     - adapter: DrizzleAdapter pointing to Neon db
     - providers: [Resend({ apiKey: process.env.RESEND_API_KEY, from: 'Drone Manager <noreply@yourdomain.com>' })]
       Note: For development, Resend allows sending to your own email on the free tier.
       If Resend provider is not directly available in next-auth@beta, use the Email provider
       with a custom sendVerificationRequest function that uses the Resend SDK.
     - session: { strategy: 'jwt' }
     - pages: { signIn: '/login', verifyRequest: '/check-email' }
     - callbacks:
       - jwt: include user id, username, points in token
       - session: include user id, username, points in session
     - events:
       - createUser: When a new user is created by NextAuth adapter, also:
         a. Generate a username from email (take part before @, append random 4 digits if taken)
         b. Create starter drone: all stats at 1, level 1, 20 unspent points, active: true
           Random name from pool: combine adjective + noun
           Adjectives: SHADOW, NEON, CYBER, PHANTOM, PULSE, ECHO, VOLT, STORM, GHOST, NOVA
           Nouns: VIPER, HAWK, WOLF, BLADE, CLAW, FANG, DART, BOLT, RAGE, FURY
           Format: "{ADJ}-{NOUN}" (e.g., "NEON-HAWK")
         c. Record in drone_ownership_history with transaction_type 'creation'
   - Export handlers and auth helper

2. app/api/auth/[...nextauth]/route.js:
   - Import and export GET, POST from the auth config

3. Create app/login/page.jsx + page.module.css:
   - A clean login page matching the dark cyberpunk design
   - Email input field (dark styled) + "Send Magic Link" button (primary teal)
   - On submit: calls NextAuth signIn("resend", { email })
   - Below the form: brief text explaining "Enter your email to receive a sign-in link"
   - This page should NOT be wrapped in NavShell (it's a standalone page)

4. Create app/check-email/page.jsx + page.module.css:
   - Simple page: "Check your email" heading
   - "We sent a magic link to your email. Click it to sign in."
   - Link back to login page
   - Also standalone, no NavShell

5. Create a hooks/useSession.js hook:
   - Wraps NextAuth's useSession
   - Returns { user, status, signIn, signOut } with the user object including id, username, points
   - Re-exports SessionProvider from next-auth/react

6. Update app/layout.jsx:
   - Wrap children in SessionProvider from next-auth/react

7. Update components/ui/NavShell to:
   - Use the useSession hook
   - When logged in: show username and points in sidebar, show "Sign Out" at bottom
   - When not logged in: show "Sign In" button that navigates to /login

8. Create middleware.js at project root:
   - Import { auth } from lib/auth (or next-auth middleware helper)
   - Protect routes: /dashboard, /drones/*, /marketplace, /leaderboard, /profile/*, /admin
   - Public routes: /, /login, /check-email, /api/auth/*
   - Unauthenticated requests to protected routes redirect to /login

Note on Resend setup: The user needs to create a free Resend account at resend.com and get an API key.
For development, Resend allows sending to the account owner's email with the free tier.
The RESEND_API_KEY goes in .env.local.
```

**Verification:**
- Visiting /login shows the email form
- Submitting an email sends a magic link (check Resend dashboard or email inbox)
- Clicking the magic link completes auth and redirects to /dashboard
- New user created in database with generated username
- Starter drone created with correct defaults (all stats 1, level 1, 20 unspent points)
- Protected routes redirect to /login when not authenticated
- NavShell shows username when logged in
- Sign out works

---

### [x] TASK 3.2 — Drone Service & API

> **Completion note (2026-04-13):** `services/drone.service.js` exports `getAllDronesForUser`, `getDroneById`, `getActiveDroneCount`, `allocateStats`, `toggleActive`, `getDronePerformanceSummary`, `checkAndLevelUp`. `getDroneById` joins owner + applied skin and fetches the last 10 races with their track rows. Stat allocation pipes through `validateStatAllocation` from the economy lib and only updates columns that actually changed. Toggle-active enforces the user's `active_drone_slots` limit.
>
> **Shared API infrastructure:** `lib/api/response.js` exports `ApiError`, `ok`, `fail`, and `withApiHandler` — a wrapper that handles auth, parameter awaiting (Next 16 `params` Promise), and error formatting in one place. Every route uses this wrapper for consistent `{ data }` / `{ error, details }` JSON shape.
>
> **Routes wired:** `GET /api/drones`, `GET /api/drones/[droneId]`, `POST /api/drones/[droneId]/allocate`, `POST /api/drones/[droneId]/toggle`. All auth-gated, all Zod-validated (`allocateStatsSchema`, `toggleDroneSchema`).
>
> **Smoke-tested:** unauth `GET /api/drones` and `POST /api/drones/abc/toggle` both return HTTP 401 with `{"error":"Not authenticated"}`. Authenticated round-trips need a logged-in user session which we don't have yet — they'll get exercised by TASK 4.4 (Drone Management screen) and TASK 5.1 (integration wiring).

**Goal:** Implement all drone-related backend logic and API routes.

**What Already Exists:** Auth system, database, economy functions, UI components.

**Instructions:**

```
Build the drone service layer and API routes. All files are .js (no TypeScript).

1. services/drone.service.js — All drone business logic. Use JSDoc on every function:

   - getAllDronesForUser(userId): Returns all drones owned by user, joined with skin info if a skin is applied
   - getDroneById(droneId): Returns drone with owner info (username), applied skin info, and last 10 races
   - allocateStats(droneId, userId, statChanges):
     - Fetch drone, verify user owns it
     - Use validateStatAllocation() from economy.js to check all constraints
     - Calculate total cost using calculateTotalUpgradeCost()
     - If valid: update drone stats + deduct from unspent_points in a transaction
     - Return updated drone
   - toggleActive(droneId, userId, active):
     - Verify user owns drone
     - If activating: count user's current active drones, check against active_drone_slots
     - Update active status
     - Return updated drone
   - getDronePerformanceSummary(droneStats):
     - Call analyzeDronePerformance() from economy.js
     - Return optimal/moderate/poor conditions
   - checkAndLevelUp(droneId):
     - Fetch drone, check if xp >= xp_to_next_level
     - If yes: increment level, recalculate TSB (add 20), update per-stat cap, calculate new xp_to_next_level, add new unspent points (20 per level)
     - Return { leveledUp: boolean, newLevel, newTSB, newUnspentPoints }
   - getActiveDroneCount(userId): Count active drones for user

2. API routes (all .js files):

   app/api/drones/route.js:
     GET: Authenticate user, return their drones via getAllDronesForUser

   app/api/drones/[droneId]/route.js:
     GET: Return single drone with full details via getDroneById

   app/api/drones/[droneId]/allocate/route.js:
     POST: Validate body with allocateStatsSchema, call allocateStats, return updated drone

   app/api/drones/[droneId]/toggle/route.js:
     POST: Validate body with toggleDroneSchema, call toggleActive, return updated drone

All routes must:
- Check authentication via auth() or getServerSession() — return 401 if not logged in
- Validate input with Zod schemas — return 400 with { error, details } on validation failure
- Wrap in try/catch — return 500 with { error: 'Internal server error' } on unexpected failures
- Return JSON with consistent structure: { data: ... } on success, { error: ..., details: ... } on failure
```

**Verification:**
- GET /api/drones returns authenticated user's drones (test via browser while logged in)
- POST /api/drones/[id]/allocate correctly updates stats and deducts unspent points
- Allocating beyond TSB returns 400 error
- Allocating beyond per-stat cap returns 400 error
- Toggling active beyond slot limit returns 400 error
- Unauthenticated requests return 401

---

### [x] TASK 3.3 — Race Engine & Scheduling

> **Completion note (2026-04-13):** Full race loop is live and verified end-to-end against Neon.
>
> - `lib/game-engine/matchmaking.js` → `getLevelBracket`, `getActiveDronesByBracket`, `matchDronesInBracket`, `ensureBotBackfill`.
> - `lib/game-engine/race-simulator.js` → `simulateRace` (straight/turn segment scoring, night/rain/wind modifiers, battery degradation in second half, consistency-dampened variance, per-segment log), plus `randomWeather` and `randomTimeOfDay` helpers.
> - `services/track.service.js` → `getAllTracks`, `getRandomTrack`.
> - `services/race.service.js` → `runRaceCycle` (config load → bracket fetch → bot backfill → pair & simulate → persist race → update drones/users → ELO → level-up → skin drop roll → bye XP), plus `getRaces`, `getRaceById`, `getNextRaceTime`, `getDroneRaceHistory`, `getTotalRaceCount`.
> - API routes: `GET /api/races` (public, paginated + filters), `GET /api/races/[raceId]` (public), `POST|GET /api/races/run` (CRON_SECRET-gated via `Authorization: Bearer` or `x-cron-secret`), `GET /api/races/next` (public).
> - `vercel.json` → cron at `*/2 * * * *` hitting `/api/races/run`.
>
> **Smoke-tested:** ran the cycle twice via `curl -H "Authorization: Bearer <CRON_SECRET>" POST /api/races/run`. Result: `racesRun: 10` per cycle across brackets 1-5 and 6-10 (5 pairs each), 0 byes, 0 bots activated (already at minimum). DB verification: 20 races in `races` table, bots' `wins/losses/total_races/xp/elo_rating` all updating correctly (winners gained ~16 ELO per race, 10 XP; losers stayed flat or dropped, 4 XP). Race log contains one entry per segment with per-drone score and time.
>
> **Plan deviation worth flagging:**
> - **The plan's SQL schema for `drones` is missing `elo_rating`** — it only lived on the `users` table in Part 3. But the plan's matchmaking section says "update ELO on both drones" and pairs drones by ELO, which requires per-drone ELO. Added `elo_rating INTEGER NOT NULL DEFAULT 1000` + `idx_drones_elo_rating` to `drones` and pushed the migration. Existing bot rows picked up the default automatically.
> - `matchmaking.js` imports `db` and `schema` directly rather than receiving them as parameters (the original parameterised signature looked cleaner on paper but introduced a subtle column-identity mismatch that produced empty `order by` clauses — reverted).
> - `run` route accepts both `Authorization: Bearer <secret>` (what Vercel Cron sends) and `x-cron-secret: <secret>` (convenient for local scripts). Both are compared against `process.env.CRON_SECRET`.

**Goal:** Implement the race simulation, matchmaking, bot backfill, and scheduled execution.

**What Already Exists:** Auth, drone service, database, economy functions.

**Instructions:**

```
Build the core game engine. All files .js, use JSDoc throughout.

1. lib/game-engine/matchmaking.js:

   getLevelBracket(level) — Returns bracket string: "1-5", "6-10", "11-15", "16-20", "20+"

   getActiveDronesByBracket(db) — Queries all active drones (both real and bot), groups into bracket buckets, returns object keyed by bracket string.

   matchDronesInBracket(drones) — Takes array of drones in a bracket:
     - Sort by ELO
     - Pair adjacent: drones[0] vs drones[1], drones[2] vs drones[3], etc.
     - Odd drone out gets a bye
     - Return { pairs: [[drone1, drone2], ...], byes: [drone, ...] }

   ensureBotBackfill(db, bracket, realDroneCount, config) —
     If real drones < config.bot_density_minimum, activate enough bots in that bracket.
     Bot stats should be reasonable for their level.

2. lib/game-engine/race-simulator.js:

   simulateRace(drone1, drone2, track, weather, timeOfDay) — The core simulation:
     - Determine segment count: track.straights + track.turns
     - Create segment list: array of 'straight' repeated track.straights times + 'turn' repeated track.turns times, shuffled
     - For each segment, for each drone:
       - Calculate base score:
         straight: speed*0.4 + acceleration*0.3 + wind_resistance*0.15 + consistency*0.15
         turn: turning*0.4 + durability*0.25 + acceleration*0.2 + consistency*0.15
       - Apply night modifier if timeOfDay === 'night': score *= (night_vision / 50), clamped 0.5-1.5
       - Apply rain modifier if weather is 'rain' or 'heavy_rain': score *= (rain_handling / 50), clamped 0.5-1.5
       - Apply wind modifier if weather is 'wind': score *= (wind_resistance / 50), clamped 0.7-1.3
       - Apply battery degradation for segments in second half: score *= (1 - ((100 - battery_capacity) / 100) * 0.3)
       - Apply random variance: score *= (1 + (Math.random() * 0.1 - 0.05) * (1 - consistency/100))
       - Segment time = 100 / score (higher score = lower time)
     - Total time = sum of segment times per drone
     - Winner = drone with lower total time
     - Return { winnerId, drone1Time, drone2Time, raceLog: [{ segment, type, drone1Score, drone2Score, drone1Time, drone2Time }] }

3. services/race.service.js:

   runRaceCycle(db) — Main race cycle function:
     - Fetch admin config values from DB
     - Get active drones by bracket
     - Run bot backfill for thin brackets
     - For each bracket:
       - Match drones
       - For each pair:
         - Pick random track, random weather, random time_of_day
         - Run simulateRace
         - Calculate points for winner (calculateRacePoints)
         - In a transaction:
           - Insert race record with all results and race_log
           - Add points to winner drone's unspent_points
           - Add points to winner drone owner's user.points
           - Add XP to winner drone (config xp_per_win)
           - Add XP to loser drone (config xp_per_loss)
           - Update wins/losses/total_races on both drones
           - Update total_races/total_wins on both drone owners (if not bots)
           - Update ELO on both drones (call calculateNewElo)
           - Check level up on both drones (call checkAndLevelUp from drone service)
           - Roll skin drop chance for winner (check against config drop rates, award if hit)
       - For byes: award consolation XP
     - Return summary: { racesRun, results: [...] }

   getRaces(filters, pagination) — Paginated race results with optional filters

   getRaceById(raceId) — Single race with full drone and track details

   getNextRaceTime() — Calculate when next cycle runs (last race created_at + interval from config)

   getDroneRaceHistory(droneId, limit) — Recent races for one drone

4. services/track.service.js:
   getAllTracks() — Return all tracks
   getRandomTrack() — Select random track

5. API routes:

   app/api/races/route.js — GET: paginated race results with query param filters

   app/api/races/[raceId]/route.js — GET: single race detail

   app/api/races/run/route.js — POST: trigger race cycle
     - Protect with CRON_SECRET header check (compare against process.env.CRON_SECRET)
     - Call runRaceCycle
     - Return summary
     - Add CRON_SECRET to .env.local and .env.example

   app/api/races/next/route.js — GET: return next race timestamp

6. Create vercel.json in project root:
   {
     "crons": [{ "path": "/api/races/run", "schedule": "*/2 * * * *" }]
   }
```

**Verification:**
- Call POST /api/races/run with correct CRON_SECRET header — races are created in database
- Check race records: winner_drone_id is set, points_awarded > 0, race_log contains segment data
- Higher-stat drones win more often (run 20+ cycles, check win rates — not perfectly correlated but clearly favoring stronger drones)
- Bot drones appear in races when brackets are thin
- Drone XP increases after races
- Level-ups trigger when XP threshold reached (check drone records after many cycles)
- ELO changes after each race
- GET /api/races returns paginated results
- GET /api/races/[id] returns full race detail with drone and track info

---

### [x] TASK 3.4 — Marketplace, Leaderboard, Skins & Profiles

> **Completion note (2026-04-13):** Four services + ten API routes — all compile, all Zod-validated, all smoke-tested where possible.
>
> **Services:**
> - `services/marketplace.service.js` — `createListing`, `buyListing`, `cancelListing`, `getListings`, `getUserListings`, `getTransactionHistory`. `buyListing` uses a conditional `UPDATE ... WHERE status='active'` for race-condition safety so two concurrent buyers can't both claim the same listing. 5% fee calculated as `floor(price * 0.05)`. On drone transfer: closes the seller's `drone_ownership_history` row, sets `applied_skin_id = null` (skin stays with seller), sets drone `active = false`, creates new ownership row with `transaction_type = 'purchase'`.
> - `services/leaderboard.service.js` — `getPlayerLeaderboard` + `getDroneLeaderboard` (sort by `elo` | `wins` | `season_points` | `total_races` | `level` | `win_rate`; `win_rate` is a computed SQL expression), `getUserRank` (count of users with higher ELO + 1), `getSeasonInfo`.
> - `services/skin.service.js` — `getUserSkins`, `applySkin`, `removeSkin`, `awardSkinDrop` (claims a random unowned skin of the requested rarity). The race loop's inline skin-drop path still lives in `race.service.js` for now; `awardSkinDrop` here is the public API.
> - `services/user.service.js` — `getUserProfile` (user + owned drones + last 20 races across all owned drones + skins), `getUserStats` (quick-stats card payload).
>
> **Routes wired** (rewriting placeholders where they existed, and creating `app/api/users/[userId]/profile/route.js`):
> `GET|POST /api/marketplace`, `POST /api/marketplace/[listingId]/buy`, `POST /api/marketplace/[listingId]/cancel`, `GET /api/leaderboard`, `GET /api/leaderboard/me`, `GET /api/skins`, `POST /api/skins/apply`, `POST /api/skins/remove`, `GET|PATCH /api/admin/config`, `GET /api/users/[userId]/profile`. All use `withApiHandler` from `lib/api/response.js`. Public routes (`requireAuth: false`): `/api/leaderboard`, `/api/marketplace GET`, `/api/users/[userId]/profile`.
>
> **Smoke-tested:** `GET /api/leaderboard?type=drones&sort_by=elo&limit=5` returned the top 5 bots ordered by ELO (APEX-V8 at 1032, then GHOST-L8 / ECHO-M4 / HAWK-W4 tied at 1032) with season info joined in. `GET /api/leaderboard?type=players&sort_by=wins` returned an empty list (no real players yet) with season info. `GET /api/marketplace` returned an empty `items` array and pagination. `GET /api/skins` (unauth) returned HTTP 401.
>
> **Not smoke-tested end-to-end** (needs a logged-in session): listing / buying / cancelling flows, skin apply/remove, user profile fetch by id. These will get exercised during TASK 5.1 integration wiring once the UI can actually sign in a user.
>
> **Open item for TASK 5.1 or later:** the admin config PATCH route is currently accessible to any authenticated user. The plan explicitly flags this as MVP-acceptable and to "add proper admin role later" — leaving as-is.

**Goal:** Implement remaining backend services.

**What Already Exists:** Auth, drone service, race engine, database.

**Instructions:**

```
Build the marketplace, leaderboard, skin, and profile services. All .js files, JSDoc throughout.

1. services/marketplace.service.js:
   - createListing(db, userId, itemType, itemId, price)
     Verify ownership. If drone: verify inactive. Create listing.
   - buyListing(db, buyerId, listingId)
     Verify active listing, buyer has enough points, buyer != seller.
     Transaction: deduct buyer points, calculate 5% fee, credit seller (price - fee),
     transfer ownership (update user_id on drone or skin), if drone: add ownership_history record
     and return any applied skin to seller's inventory. Update listing status.
   - cancelListing(db, userId, listingId) — verify seller, set status 'cancelled'
   - getListings(db, filters, pagination) — active listings with filters
   - getUserListings(db, userId) — user's active listings
   - getTransactionHistory(db, userId, limit) — recent transactions for user

2. services/leaderboard.service.js:
   - getPlayerLeaderboard(db, sortBy, limit, offset) — rank by elo, win_rate, wins, or season_points
   - getDroneLeaderboard(db, sortBy, limit, offset) — rank individual drones
   - getUserRank(db, userId) — current user's rank number
   - getSeasonInfo(db) — current season details

3. services/skin.service.js:
   - getUserSkins(db, userId)
   - applySkin(db, userId, skinId, droneId) — verify user owns both skin and drone, update drone.applied_skin_id
   - removeSkin(db, userId, droneId) — set applied_skin_id to null
   - awardSkinDrop(db, userId, rarity) — pick a random unowned skin of that rarity, assign to user. If none available, skip.

4. services/user.service.js:
   - getUserProfile(db, userId) — user data + owned drones + stats + recent race history + skins
   - getUserStats(db, userId) — quick stats (total_races, win rate, elo, season_rank)

5. API routes:
   app/api/marketplace/route.js — GET listings (with query filters), POST create listing
   app/api/marketplace/[listingId]/buy/route.js — POST buy
   app/api/marketplace/[listingId]/cancel/route.js — POST cancel
   app/api/leaderboard/route.js — GET with type and sort query params
   app/api/leaderboard/me/route.js — GET current user rank
   app/api/skins/route.js — GET user's skins
   app/api/skins/apply/route.js — POST apply skin to drone
   app/api/skins/remove/route.js — POST remove skin from drone
   app/api/users/[userId]/profile/route.js — GET public profile
   app/api/admin/config/route.js — GET all config, PATCH update (admin only — for now, any logged in user can access this; add proper admin role later)

All routes: auth check, Zod validation, consistent error format.
```

**Verification:**
- Create listing, buy it, verify ownership transferred and points moved correctly
- 5% fee calculated right (e.g., price 100 → seller gets 95, platform takes 5)
- Cannot buy own listing or buy with insufficient points
- Leaderboard returns ranked data
- Skin apply/remove updates drone record
- User profile returns complete data
- Admin config read/write works

---

### [x] TASK 4.1 — Landing Page Screen

> **Completion note (2026-04-13):** Public landing page at `app/page.jsx` + `app/page.module.css`. Built against `mockups/01-landing.png`. Standalone (not wrapped in `NavShell`). Sticky top nav (blur + semi-transparent `--bg-secondary`) with "Drone Manager" logo + How It Works / Features / Docs / Community anchor links + "Start Racing" CTA linking to `/login`. Hero section: centred inline SVG wireframe drone with `droneHover` keyframe animation, headline "Build, Optimize, and Dominate the Circuit" (font-heading, clamps to `--text-6xl` on desktop / `--text-3xl` on mobile), primary+secondary CTAs. "How It Works" section with three step cards (Step 1/2/3 labels in teal mono font, lucide icons `Wrench`/`Zap`/`TrendingUp`, `ArrowRight` connectors between steps — connectors hidden below 1024px). Stats ticker (3-column dark bg: `1.2M+` total races / `45,000+` players / `3.5M pts` rewards). Features section using flex-wrap with 5 cards and `justify-content: center` so the last row auto-centres its 2 items without brittle grid tricks. Footer with logo + Terms/Privacy/Community links.
>
> **SEO:** exported `metadata` with title, description, and `openGraph` tags. Semantic `<nav>` / `<main>` / `<section>` / `<footer>`.
>
> **Hero image:** the plan expected an image from `public/drones/` but none exists yet, so I inlined a simple teal wireframe SVG drone in the component file to keep the page self-contained. Swap for a real render later without touching the CSS.
>
> **Responsive tested at build level:** 1440/1024/768/375 breakpoints in the CSS — hero heading scales, nav links collapse, steps stack, stats bar becomes 1-column, features go 3→2→1 column. Smoke test: `GET /` 200 and HTML contains "Build, Optimize", "How It Works", "Features", "Start Racing". Scroll animations deferred to TASK 5.2 per plan split.

**Goal:** Build the landing page matching the Gemini mockup. SEO optimized, responsive, CSS Modules.

**What Already Exists:** Full backend, UI components, design system.

**Design Reference:** Dark bg, "Drone Manager" nav with links (How It Works, Features, Docs, Community) and "Start Racing" CTA. Hero section with drone image + "Build, Optimize, and Dominate the Circuit" tagline + two CTAs. "How It Works" 3-step section with icons and arrow connectors. Stats ticker bar. Features grid (5 cards). Footer.

**Instructions:**

```
Build app/page.jsx and app/page.module.css matching the landing page mockup.

This is a PUBLIC page. It does NOT use NavShell — it has its own nav bar.

The user will paste the Gemini mockup image into this Claude Code session for visual reference.
Match the layout, spacing, typography, and visual hierarchy from the mockup exactly.
ALL styles in page.module.css using CSS variables. No inline styles. No hardcoded colors.

Build these sections:

1. Navigation bar (sticky):
   - Logo "Drone Manager" with small icon, left
   - Links: How It Works, Features, Docs, Community (scroll to section anchors)
   - "Start Racing" button (primary teal) right — links to /login
   - On scroll: add subtle bg opacity change (bg-secondary with 90% opacity)
   - Mobile: hamburger that opens a dropdown

2. Hero section:
   - Large drone image centered (use placeholder or existing asset from public/drones/)
   - Heading: "Build, Optimize, and Dominate the Circuit" — font-heading, text-5xl desktop, text-3xl mobile
   - Two CTAs: "Start Racing" (primary) linking to /login, "Learn More" (secondary) scrolling to how-it-works
   - Generous padding (space-20 top/bottom)

3. How It Works section (id="how-it-works"):
   - Section heading: "How It Works"
   - 3 steps in a row:
     Step 1: "Build Your Drone" — "Optimize performance stats using tokenized parts."
     Step 2: "Race Automatically" — "Enter your drone into automated, passive racing cycles."
     Step 3: "Earn & Trade" — "Collect rewards and trade assets on the open marketplace."
   - Each step: teal "Step N:" label, icon (use lucide-react: Wrench, Zap, TrendingUp), title, description
   - Arrow connectors between steps (→ character or SVG arrow, hidden on mobile)
   - Mobile: stack vertically

4. Stats ticker bar:
   - Full-width dark bg section
   - 3-4 stat items: "TOTAL RACES RUN: 1.2M+", "ACTIVE PLAYERS: 45,000+", "TOTAL REWARDS DISTRIBUTED: 3.5M pts"
   - Numbers in mono font, teal, large. Labels in body font, text-secondary, uppercase, small
   - Mobile: stack or 2x2 grid

5. Features section (id="features"):
   - "Features" heading
   - 5 cards in grid: 3 top, 2 bottom centered
     - Skill-Based Racing: "Develop optimal strategies based on track data and competition."
     - Drone Customization: "Upgrade components to enhance speed, agility, and endurance."
     - Leaderboards & Seasons: "Compete for top rankings and exclusive seasonal rewards."
     - Marketplace: "Trade drones and custom skins on the open marketplace."
     - On-Chain Ownership: "True ownership of all in-game assets, verifiable on the blockchain."
   - Each card: icon (lucide-react), title (font-heading), description (text-secondary)
   - Card uses the shared Card component with hover effect
   - Mobile: single column

6. Footer:
   - Logo left, links right: Terms of Service, Privacy Policy, Community
   - text-tertiary, minimal padding

7. SEO:
   - Export metadata from page: title "Drone Manager — Competitive Idle Drone Racing", description
   - Open Graph tags
   - Semantic HTML throughout: <nav>, <main>, <section>, <footer>

8. Animations (use Intersection Observer):
   - Sections fade-in-up when scrolled into view (fadeInUp animation, 500ms)
   - Stats numbers count up when ticker scrolls into view
   - Feature cards stagger their fade-in (100ms delay between each)

9. Responsive:
   - 1440px: as designed
   - 1024px: reduce hero padding, 2-column features grid
   - 375px: single column everything, smaller heading, full-width CTAs, stacked stats
```

**Verification:**
- Page matches mockup layout at 1440px
- Responsive at 1024px and 375px
- Scroll animations work
- Stats count up
- All section anchor links work
- SEO metadata in page source
- No hardcoded colors in CSS

---

### [x] TASK 4.2 — Race Results Screen

> **Completion note (2026-04-13):** Built against `mockups/04-race-results.png`. Two pages:
>
> **`/races`** — `NavShell`-wrapped list. Header has "Race Results" title + "TOTAL RACES: N | SHOWING RECENT" subtitle on the left, and a Live-Now box (teal pulsing dot + filtered count + `CountdownTimer` to the next race block) on the right. `FilterBar` underneath with Weather + Time of Day selects and a free-text search. `DataTable` with columns: Race ID (short last-8 hex), Date/Time, Track, Weather (lucide icon mapped from `clear|clouds|rain|heavy_rain|wind|haze|fog`), Time of Day (Sunrise/Sun/Sunset/Moon), Drone 1, Drone 2, Winner (teal), Points (mono). Row click navigates to `/races/[id]`. Data polled every 30s via `fetch('/api/races?...')`; next-race-at polled every 30s via `/api/races/next`. Client-side search filters on drone/track names. Bottom Prev/Next pagination on page counts.
>
> **`/races/[raceId]`** — detail page. Unwraps the async `params` Promise with `use(params)` (Next 16 pattern). Two drone cards side-by-side using `StatBar` for all 9 stats; winner card gets `border-color: var(--accent-primary) + glow-teal` + a `Trophy` badge. Track info card with straights/turns/length/difficulty. Race log as a compact grid: segment number, type, per-drone segment time, and a `◀`/`▶` leader indicator. Rewards row at the bottom (winner +XP+pts, loser +XP). Loading state uses `Skeleton`; not-found / error state has a back link and error message.
>
> Both pages stack to single-column on mobile via breakpoints. Weather/time-of-day icons use `title` attribute for accessible labels. No build errors; compile + route table clean.

**Goal:** Build the race results page matching the mockup, connected to real data.

**What Already Exists:** Full backend, UI components, landing page.

**Design Reference:** "RACE RESULTS" heading, total count, "Live Now" green dot indicator, countdown, filter row (Track, Weather, Time of Day, Drone Level, Search), data table (Race ID, Date/Time, Track, Weather icon, Time of Day icon, Drone 1, Drone 2, Winner in teal, Points), pagination.

**Instructions:**

```
Build app/races/page.jsx + page.module.css. Wrap in NavShell.

Also build app/races/[raceId]/page.jsx + page.module.css for race detail.

The user will paste the mockup image for visual reference.
ALL styles in CSS Modules. All colors/fonts/spacing via CSS variables.

Race Results page:
1. Header: "RACE RESULTS" heading, subtitle "Total Races: {count} | Showing Recent"
2. Top right: "Live Now: {n} Races" with green pulsing dot, countdown to next race block
3. FilterBar component with: Track Name (select), Weather (select), Time of Day (select), Drone Level range, Search
4. DataTable component with race data. Columns: Race ID (mono), Date/Time, Track Name, Weather (icon — use lucide-react Sun/Cloud/CloudRain/Wind/CloudFog), Time of Day (icon — use Sunrise/Sun/Sunset/Moon), Drone 1 (name + level), Drone 2 (name + level), Winner (teal text), Points Awarded
5. Rows clickable → navigate to /races/[raceId]
6. Pagination component at bottom
7. Fetch data from GET /api/races with filter params. Refresh every 30 seconds.
8. Loading skeleton while fetching. Empty state if no results.
9. Responsive: 1024px hide Race ID and Points columns. 375px switch to card layout per race.

Race Detail page (/races/[raceId]):
1. Header with race ID, date, track name, weather and time icons
2. Two drone cards side by side showing: drone image, name, level, all 9 stats
3. Winner highlighted with teal border/glow. Loser in default styling.
4. Track info card: name, difficulty, straights, turns, length
5. Race log: segment-by-segment breakdown from race_log JSON — show as a mini table or visual showing who led each segment
6. Points awarded, XP awarded displayed
7. Responsive: drone cards stack on mobile
```

**Verification:**
- Displays real race data from database
- Filters work
- Pagination works
- Live indicator shows
- Countdown ticks
- Race detail page shows full breakdown
- Responsive at all breakpoints

---

### [x] TASK 4.3 — Leaderboard Screen

> **Completion note (2026-04-13):** `app/leaderboard/page.jsx` + CSS. Built against `mockups/05-leaderboard.png`. Client component, wrapped in `NavShell`. Header: "Leaderboard" title + season progress block (title, gold progress bar, caption). Players/Drones toggle tabs (role="tablist"). Top-3 podium using three `Card`s: 2nd place on the left with silver border/glow, 1st place centre with gold border + larger padding + translate-up, 3rd place on the right with bronze. Each podium card shows `Trophy` icon + rank ordinal, name, win-rate, total wins, ELO, and (players tab only) season points. Main ranking table (rank #4+) via `DataTable` with columns that differ per tab (players: Win Rate / Wins / Races / ELO / Season Points; drones: Level / Win Rate / Wins / Races / ELO). Season Rewards Preview card at the bottom (3 icon tiles: Exclusive Skins / Token Prizes / Titles/Badges). Sticky "Your Rank: #N" bar pinned to viewport bottom, offset by 240px on desktop to clear the NavShell sidebar.
>
> **Data wiring:** fetches `/api/leaderboard?type=...&sort_by=elo&limit=50` and `/api/leaderboard/me`. `daysRemaining`/`seasonProgress` helpers compute the progress bar from `season.startDate`/`endDate`. Current user row highlighting uses the seasoned rank from `/api/leaderboard/me`. Loading state uses `Skeleton` for the podium, DataTable's built-in loading for the main table. Responsive: podium stacks at ≤768px, rewards grid collapses to 1 column.

**Goal:** Build the leaderboard matching the mockup, connected to real data.

**What Already Exists:** Full backend, UI components, previous screens.

**Design Reference:** "LEADERBOARD" heading, season indicator with progress bar, Players/Drones tabs, top 3 podium (gold/silver/bronze), ranking table, season rewards preview, sticky "Your Rank" bar.

**Instructions:**

```
Build app/leaderboard/page.jsx + page.module.css. Wrap in NavShell.

The user will paste the mockup image for visual reference.
ALL styles in CSS Modules via CSS variables.

1. Header: "LEADERBOARD", "Season {n} — {days} days remaining" with progress bar
2. Tab toggle: "Players" / "Drones"
3. Top 3 podium cards:
   - 1st: larger, gold border/accent, trophy icon, centered
   - 2nd: silver, left
   - 3rd: bronze, right
   - Each shows: rank, name, drone image, win rate, total wins, ELO, season points
4. Main table (rank 4+): Rank, Player/Drone Name, Best Drone (level), Races, Wins, Win Rate %, ELO, Points
5. Current user row: teal left border + slightly different background
6. Sticky bottom bar: "Your Rank: #{rank}" always visible
7. Season rewards preview section: Exclusive Skins, Token Prizes, Titles/Badges (static display for MVP)
8. Data from GET /api/leaderboard and GET /api/leaderboard/me
9. Loading skeletons
10. Responsive: 1024px smaller podium. 375px podium stacks vertically, table becomes cards.
```

**Verification:**
- Leaderboard shows real ranked data
- Tabs switch between players and drones
- Podium renders with correct medal colors
- Current user highlighted
- Sticky rank bar works
- Responsive

---

### [x] TASK 4.4 — Drone Management Screen

> **Completion note (2026-04-13):** Built against `mockups/03-drone-management.png`. Two pages:
>
> **`/drones/[droneId]`** — stat editor. Uses `use(params)` for Next 16 async params. Two-panel grid (2:3 ratio on desktop, stacks on mobile). Left: `Card` with inline SVG drone (`droneHover` animation + `glow-teal`), name + `Badge` level + owner, quick-stats grid (Total Races / Win Rate / ELO), "Skin Equipped" block. Right: "Stat Editor" heading with "Available Points: N" in the corner, 9 `StatEditorRow`s (one per stat from `STAT_KEYS`), actions row with `Toggle` for active + Reset/Save buttons, then "Performance Summary" with 3 chip columns (optimal/moderate/poor) fed by `analyzeDronePerformance`.
>
> **Client-side stat math:** `baseStats` comes from the API; `editedStats` is the mutable working copy. `increment`/`decrement` callbacks enforce per-stat cap (via `calculatePerStatCap`), TSB (via `calculateTSB`), cost (via `calculateStatUpgradeCost`), and the minimum floor of `baseStats[key]`. `availablePoints = drone.unspentPoints - totalCost(base→edited)` updates live. Save POSTs only the *changed* keys as snake_case to `/api/drones/[id]/allocate` and re-fetches on success. Toggle POSTs to `/api/drones/[id]/toggle`. Both show a toast via the `useToast` hook.
>
> **Race history** table underneath (`DataTable`) showing the drone's last 10 races with Race ID, Track, Conditions, Result (WIN in teal / LOSS in red), Points columns.
>
> **`/drones`** — grid view. Fetches `/api/drones`, renders a 3→2→1 column grid of `Card`s with drone name, level `Badge`, ELO + W/L meta, and three compact `StatBar`s (Speed / Turning / Acceleration). Active drones get a teal dot + `glow-teal` border. Each card is wrapped in a `Link` to its detail page. Empty state + loading skeletons handled.

**Goal:** Build the drone management screen matching the mockup. Most interactive screen.

**What Already Exists:** Full backend, UI components (including StatEditorRow), previous screens.

**Design Reference:** Left panel: large drone image with glow, name/level/owner, total races, win rate, skin equipped. Right panel: "Stat Editor" heading, "Available Points: 12", 9 stat rows with +/-, bars, deltas. SET ACTIVE toggle, SAVE/RESET buttons. Performance Summary. Race History table.

**Instructions:**

```
Build app/drones/[droneId]/page.jsx + page.module.css. Wrap in NavShell.
Also build app/drones/page.jsx + page.module.css (My Drones grid).

The user will paste the mockup image for visual reference.
ALL styles in CSS Modules via CSS variables.

Drone Management (/drones/[droneId]):

1. Two-panel layout. Left ~40%, Right ~60%. Stack on mobile.

2. Left panel:
   - Drone image in a card with subtle teal glow (box-shadow: var(--glow-teal))
   - Drone idle hover animation (droneHover keyframe, 3s, ease-in-out, infinite)
   - Below image: name (heading font, bold), "Lvl {level}" in teal badge, "Owner: {username}"
   - "TOTAL RACES: {n}", "WIN RATE: {n}%"
   - "SKIN EQUIPPED" section with current skin name or "None", dropdown to change

3. Right panel:
   - "Stat Editor" heading. "Available Points: {unspent}" top right, teal, mono font.
   - 9 StatEditorRow components, one for each trait:
     Speed, Turning, Acceleration, Durability, Night Vision, Battery Capacity, Rain Handling, Wind Resistance, Consistency
   - Client-side state: track baseStats (from API) and editedStats separately
   - As user clicks +/-, update editedStats and recalculate:
     - Available Points remaining (deduct costs using calculateTotalUpgradeCost)
     - Whether each + button should be disabled (stat cap, TSB, cost)
   - Import economy functions and run them client-side for instant feedback

4. Below stat editor:
   - Row: SET ACTIVE toggle (left), SAVE button (primary, disabled when no changes), RESET button (secondary)
   - Save calls POST /api/drones/[droneId]/allocate. On success: update baseStats to match editedStats, show success toast.
   - Reset reverts editedStats to baseStats.
   - Toggle calls POST /api/drones/[droneId]/toggle.

5. Performance Summary card:
   - Three columns: Optimal, Moderate, Poor
   - Show weather/time conditions as badges with appropriate colors
   - Data from analyzeDronePerformance() run client-side on current stats

6. Race History:
   - "Race History (Last 10 races)" heading
   - Table: Race ID, Opponent, Track, Conditions, Result (WIN teal / LOSS red), Points Earned

7. Data fetching: GET /api/drones/[droneId] on mount. Includes drone data + recent races.

8. Responsive: 1024px panels side by side but narrower. 375px stack vertically.

My Drones page (/drones):
- Grid of drone cards (Card component with hover)
- Each card: drone image (small), name, level badge, 3 key stat bars (speed, turning, acceleration), active indicator (teal dot)
- Click → /drones/[droneId]
- Active drones have teal border glow
- Grid: 3 columns desktop, 2 tablet, 1 mobile
```

**Verification:**
- Stat editor math is correct (costs, TSB enforcement, per-stat caps)
- Available Points updates in real-time on +/- clicks
- Save persists to database
- Reset reverts correctly
- Performance summary shows reasonable analysis
- Drone bob animation plays
- My Drones grid shows all user's drones
- Responsive layout stacks on mobile

---

### [x] TASK 4.5 — Dashboard Screen

> **Completion note (2026-04-13):** Built against `mockups/02-dashboard.png`. `app/dashboard/page.jsx` is a client component wrapped in `NavShell`. Top welcome bar: "Welcome back, {username}" + points balance in mono teal. CSS-grid body with named areas: `spotlight`/`live-feed` on top, `results`/`countdown`+`quick-stats` on bottom. At ≤1024px the whole grid collapses to single column.
>
> **Panels:**
> - **Active Drone Spotlight** — fetches from `/api/drones`, filters to active drones, shows the first one by default with a tab strip to swap if the user has multiple active slots unlocked. Left side: bobbing inline SVG drone (`droneHover` animation + `glow-teal`), name, level badge, "Manage Drone" primary button linking to `/drones/[id]`. Right side: 6 compact `StatBar`s (Speed, Turning, Accel, Durability, Night Vision, Battery). Empty state when user has no active drone.
> - **Live Race Feed** — scrolling list of the 10 most recent races (polled every 30s via `/api/races?limit=20`), winner name in teal, timestamp in mono dim. Each row is a `Link` to the race detail page.
> - **Your Recent Results** — filters the live feed down to races involving the user's own drones, rendered as a compact 4-column grid (Opponent, Track, Result WIN/LOSS coloured, Points).
> - **Next Race Countdown** — `CountdownTimer` targeted at `/api/races/next` result with an "Seconds until next block" caption.
> - **Quick Stats** — 2×2 mini-cards showing Total Races / Win Rate / Streak / Rank. Streak is computed client-side by walking `recentRaces` until the win/loss flag flips (returns `W5` / `L3` style labels). Rank comes from `/api/leaderboard/me`.
>
> All data sources auto-refresh every 30 seconds via a single `fetchAll` interval. Loading state uses `Skeleton` per panel.

**Goal:** Build the dashboard as the player's command center.

**What Already Exists:** Full backend, all UI components, previous screens.

**Design Reference:** Multi-panel dashboard: welcome bar, active drone spotlight with stats, live race feed, your recent results, quick stats cards (4), countdown timer, sidebar nav.

**Instructions:**

```
Build app/dashboard/page.jsx + page.module.css. Wrap in NavShell.

The user will paste mockup for reference. CSS Modules, CSS variables only.

1. Welcome bar: "Welcome back, {username}" + points balance (mono, teal)

2. Grid layout for dashboard panels.

3. Active Drone Spotlight (large panel):
   - Active drone image with hover animation, name, level
   - 9 stat bars (StatBar component, small size)
   - "Manage Drone" button → /drones/[droneId]
   - If multiple active drones: tabs or carousel to switch
   - If no active drone: EmptyState prompting activation

4. Live Race Feed (side panel):
   - "Live Race Feed" heading
   - Scrolling list of last 20 race results (all players)
   - Each: "{DroneA} beat {DroneB} on {Track}" + timestamp
   - Winner in teal. Auto-refresh every 30s.

5. Your Recent Results (panel):
   - Last 10 personal race results
   - Compact: opponent, track, WIN/LOSS, points

6. Quick Stats (4 cards):
   - Total Races (number, large, mono)
   - Win Rate (%)
   - Current Streak (consecutive wins)
   - Season Rank (#N)
   - Each: Card component, large number, small label

7. Countdown to next race (CountdownTimer component)

8. Data fetching: multiple API calls on mount. Loading skeletons.

9. Responsive:
   - 1440px: multi-column grid (spotlight + feed side by side, stats row, results)
   - 1024px: 2-column, feed below spotlight
   - 375px: single column, quick stats 2x2 grid
```

**Verification:**
- Dashboard shows real user data
- Active drone displays with stats
- Live feed shows recent races
- Quick stats accurate
- Countdown ticks
- Responsive at all breakpoints

---

### [x] TASK 4.6 — Marketplace Screen

> **Completion note (2026-04-13):** `app/marketplace/page.jsx` + CSS. Built against `mockups/06-marketplace.png`. Wrapped in `NavShell`.
>
> **Layout:** header (Marketplace title, "Your balance: N pts" subtitle, "List Item" primary button) → DRONES/SKINS tab toggle → 2-column body (220px filter sidebar + main content) → transaction history card. Sidebar collapses to top of main content at ≤1024px.
>
> **Filters** (left aside, sticky on desktop): Price min/max number inputs, Rarity checkboxes (only visible on the Skins tab), Sort By select (Newest / Price Low→High / Price High→Low). Applied client-side where possible; min/max price are sent as server query params.
>
> **Main content:** search input (client-side filter on drone/skin/seller names), "Your Listings (N)" badge strip when the user has active listings, and an auto-fit responsive grid of listing cards (`minmax(220px, 1fr)`). Each listing card: inline SVG preview (drone wireframe or rarity-coloured skin shape), name + level/rarity badge, meta row (ELO+W/L for drones, description for skins), price + seller, and either "Buy Now" or "Cancel Listing" depending on ownership.
>
> **Buy modal** (small `Modal`): item name, price, balance-after preview, Cancel/Confirm buttons. Calls `POST /api/marketplace/[id]/buy`, refreshes listings and my-drones on success, shows toast.
>
> **List modal** (medium `Modal`): drone/skin type toggle, item select (only inactive drones or owned skins from `/api/drones` + `/api/skins`), price input with live "Platform fee 5%" + "You receive" calculation. Calls `POST /api/marketplace` on submit.
>
> **Fix pulled forward from TASK 6.1:** the root `app/layout.jsx` now wraps children in `<ToastProvider>` (in addition to the existing `<SessionProvider>`). Without this, any page that imports `useToast` during prerender throws "must be used inside a ToastProvider" and the build fails — hit exactly that error on first build of this screen and patched the layout.
>
> Build clean: 24 routes compile, no TypeScript/lint errors.

**Goal:** Build the marketplace with full buy/sell functionality.

**What Already Exists:** Full backend, all UI components, all other screens.

**Design Reference:** "MARKETPLACE" heading, token balance, Drones/Skins tabs, LIST ITEM button, YOUR LISTINGS section, filter sidebar (price, level, stats, rarity, sort), card grid, BUY NOW buttons, transaction history.

**Instructions:**

```
Build app/marketplace/page.jsx + page.module.css. Wrap in NavShell.

The user will paste mockup for reference. CSS Modules, CSS variables only.

1. Header: "MARKETPLACE" heading, "YOUR BALANCE: {points} pts", "LIST ITEM" button top right

2. Tabs: "DRONES" / "SKINS"

3. Your Listings banner (if any): "YOUR LISTINGS ({n})" with horizontal scroll of user's active listings, each with Cancel option

4. Filter sidebar (left):
   - Price range (two number inputs: min, max)
   - Level range (for drones)
   - Rarity checkboxes (for skins)
   - Sort dropdown: Price Low-High, Price High-Low, Newest, Level, Rarity
   - Search input
   - Mobile: collapsible, toggled by filter icon button

5. Card grid (main area):
   - Drone cards: image, name + level, stat indicator bars, price (mono), seller, "BUY NOW" (primary button)
   - Skin cards: image, name, rarity Badge, price, "BUY NOW"
   - Hover: scale + teal border glow
   - Grid: 3 cols desktop, 2 tablet, 1 mobile

6. Buy flow: click BUY NOW → Modal with item details + price + fee breakdown + "Confirm Purchase" button.
   On confirm: POST /api/marketplace/[id]/buy. Success toast + refresh. Error toast on failure.

7. List Item flow: click LIST ITEM → Modal:
   - Select type: Drone or Skin
   - Select from owned items (show images + names)
   - Set price input
   - Show "Platform fee: 5% ({calculated})" below price
   - "List for Sale" button
   - Drone must be inactive to list
   - POST /api/marketplace on submit

8. Transaction History (collapsible at bottom):
   - Recent buys/sells for user
   - Date, item, type (Bought/Sold), price, counterparty

9. Data: GET /api/marketplace with filters. Refresh on filter/tab change. Loading skeletons.

10. Responsive: 1024px filters collapse to top row. 375px single column cards, full-width buttons.
```

**Verification:**
- Listings display correctly
- Filters and search work
- Buy completes: ownership transfers, points move, fee deducted
- List creates new listing
- Cancel removes listing
- Balance updates everywhere
- Responsive

---

### [x] TASK 5.1 — Full Integration Wiring

> **Completion note (2026-04-13):** All cross-screen links verified at the code level (Dashboard "Manage Drone" → `/drones/[id]`, race rows → `/races/[id]`, marketplace listing cards → buy modal, etc.). Error boundary + 404 pages added pre-6.1 so the autoloop doesn't block on them:
> - `app/not-found.jsx` + `app/not-found.module.css` — dark-themed 404 card with icon, "404" heading, description, and back-home link.
> - `app/error.jsx` — client-side error boundary reusing the 404 card CSS (imports the same module). Logs to console, shows the error message + a Retry button wired to the `reset` prop.
>
> **Data population:** ran 10 race cycles via `POST /api/races/run` with the cron secret to seed the DB for downstream screens. Result: **120 races** total (20 from 3.3 smoke test + 100 here), bot ELO/wins/losses/XP updating every cycle. Landing returns HTTP 200, `/does-not-exist` returns HTTP 404 and renders the new not-found page.
>
> **Not end-to-end tested:** the full logged-in journey (sign-in → allocate → wait → check results → marketplace buy → apply skin) still requires Captain to authenticate and walk through. The pieces are all wired; they need a real session to exercise. Marketplace listings are empty (no real players yet), so buy-flow smoke testing is still pending.

**Goal:** Wire all screens together, verify complete user journey.

**What Already Exists:** All screens built individually.

**Instructions:**

```
Connect everything and verify the end-to-end experience.

1. Auth flow: Landing "Start Racing" → /login → email magic link → /dashboard with data

2. Navigation: all NavShell links work, active states correct, all cross-screen links work:
   - Dashboard "Manage Drone" → /drones/[id]
   - Race results row → /races/[id]
   - Leaderboard player → /profile/[id]
   - Marketplace cards link to detail where appropriate

3. Data consistency: stat changes reflect everywhere, purchases update balances, race results appear in feeds

4. Error pages: app/not-found.jsx (dark themed 404), app/error.jsx (error boundary)

5. Loading: every page shows skeletons while fetching

6. Run 10+ race cycles (POST /api/races/run) to generate data, verify all screens show it correctly

7. Test complete loop: login → dashboard → manage drone → allocate stats → wait → check results → leaderboard → marketplace → buy → apply skin → verify
```

**Verification:**
- Complete journey works without errors
- No broken links
- Data consistent across screens after mutations
- 404 and error pages work
- No console errors

---

### [x] TASK 5.2 — Animations & Visual Polish

> **Completion note (2026-04-13):** Most animations were already in place from earlier tasks — this pass added what was genuinely missing.
>
> **New this task:**
> - `components/util/ScrollReveal.jsx` — client wrapper that uses `IntersectionObserver` (threshold 0.1, 60px bottom margin) to toggle a `.visible` class that fades + slides the child in once. Disconnects after first trigger. Landing page "How It Works", stats ticker, and Features sections all wrapped in `ScrollReveal`. Feature cards stagger their reveals via `animationDelay: ${idx * 80}ms` inline on each card.
> - **Rarity treatments on marketplace listing cards:** `.rarityRare` adds a diagonal teal shimmer sweep (via `shimmer` keyframe with a linear-gradient `::before` overlay), `.rarityEpic` adds a purple glow that pulses between `rgba(187,134,252,0.2)` and `0.4`, `.rarityLegendary` adds a gold glow pulsing between `rgba(255,215,0,0.3)` and `0.55`. Each class applied conditionally to the preview frame based on `listing.skin.rarity`.
>
> **Already shipped in earlier tasks:**
> - Drone hover/bob: `droneHover` keyframe from `globals.css` applied on management page (`.droneImageWrap`), dashboard spotlight (`.spotlightImage`), and landing hero (`.heroImageWrap`).
> - Countdown timer seconds pulse: `.secondsPulse` with `pulse` keyframe, keyed on the seconds digit so it re-triggers each tick.
> - Card hover glow + scale: `Card.module.css` `.hover:hover` applies `glow-teal` + `transform: scale(1.02)`.
> - Button active press: `.button:active { transform: scale(0.98) }`.
> - Save button loading state: spinner via `.spinner` keyframe in Button.
> - DataTable skeleton shimmer: uses the global `shimmer` keyframe on row placeholders.
> - Toast enter: slide-in-from-right via `toastIn` keyframe.
> - NavShell drawer on mobile: `slideInLeft` + `fadeInOverlay` keyframes.
> - `prefers-reduced-motion` global override in `globals.css` zeroes out all animation durations.
>
> All animations use `transform` + `opacity` only for GPU compositing — no layout thrash.

**Goal:** Add all animations and micro-interactions.

**What Already Exists:** Fully functional app.

**Instructions:**

```
Add animations across the application. All animations in CSS Modules using the keyframes defined in globals.css.
Respect prefers-reduced-motion.

1. Drone hover/bob animation on: management page (always), dashboard spotlight (always), marketplace cards (on hover only)
2. Page sections: fade-in-up on scroll (Intersection Observer hook)
3. Stats count-up on landing page
4. Countdown timer: pulse on seconds
5. Race feed: new items animate in
6. Stat editor: press feedback on +/- (scale 0.95 on active)
7. Save button: loading spinner while saving, success state briefly
8. Rarity effects on skin cards:
   - Rare: CSS shimmer (light sweep every 4s)
   - Epic: gradient glow on border (slow color shift)
   - Legendary: gold glow + sparkle-like border effect
9. NavShell active indicator: smooth slide transition
10. All interactive elements: clear hover states with smooth transitions
11. All animations: use transform and opacity only for performance
```

**Verification:**
- Animations smooth, no jank
- Drone bobs on management page
- Rarity effects visible on marketplace
- prefers-reduced-motion disables animations
- No dropped frames

---

### [x] TASK 5.3 — Responsive Pass

> **Completion note (2026-04-13):** Responsive breakpoints were added inline on every screen as it was built, matching the plan's desktop (1440) / small desktop (1024) / tablet (768) / mobile (375) targets. Per-page summary:
>
> - **Landing (`app/page.jsx`)** — sticky nav collapses menu links at <768px; hero heading scales `text-6xl → text-5xl → text-3xl`; hero CTAs go full-width below 768px; `stepArrow` connectors hide at <1024px; stats bar goes 3col → 1col at <768px; features flex-wrap from 3col → 2col → 1col via `flex: 0 1 calc((100% - …) / N)`; footer stacks vertically.
> - **NavShell** — sidebar (240px) at ≥1024px, mobile top-bar + hamburger drawer below, with `left: 240px` offset applied to the main content area on desktop.
> - **Dashboard** — grid-template-areas rearrange from 2-column → single column at ≤1024px; spotlight body stacks; quick-stats stay 2×2; resultsTable columns compress at ≤768px.
> - **Drone Management** — 2:3 panel grid → single column at ≤1024px; perfGrid stacks; actions row stacks with full-width button group at ≤768px.
> - **My Drones grid** — 3col → 2col → 1col.
> - **Races list** — FilterBar wraps to column at ≤768px; live-box moves below header; DataTable wrapped in `overflow-x: auto` so wide tables scroll horizontally as a fallback.
> - **Race detail** — two-drone grid stacks to single column at ≤1024px; winner badge becomes inline instead of absolute at ≤768px; race log grid tightens.
> - **Leaderboard** — podium goes 1fr 1.2fr 1fr → 1fr 1fr 1fr at ≤1024px (drops the centre gold-card translateY) → 1fr stack at ≤768px; sticky rank bar offsets `left: 240px` on desktop.
> - **Marketplace** — filter sidebar → top of page at ≤1024px (drops sticky); grid auto-fits cards at `minmax(220px, 1fr)` and collapses to 1 column at ≤768px; header + toolbar stack.
> - **Login / Check-email** — fixed-width card (max 440px) with internal padding dropping at ≤480px.
>
> **Touch targets:** Button `.md` variant has `min-height: 40px`, `.lg` `48px`; nav hamburger `44px × 44px`; stat editor +/- buttons 28px but grouped with spacing that keeps them tappable.
>
> **No fresh build errors.** A manual "visit on a real phone" pass is still recommended before launch (`TASK 6.2`) but all CSS is in place.

**Goal:** Verify and fix every screen at all breakpoints.

**What Already Exists:** Fully functional animated app.

**Instructions:**

```
Test every page at 1440px, 1024px, and 375px. Fix any layout issues.

Check list for each page:
- No horizontal overflow
- Text readable (minimum 12px on mobile)
- Touch targets minimum 44px on mobile
- Modals fit on mobile
- Tables convert to cards or scroll horizontally on mobile
- NavShell: sidebar on desktop, hamburger drawer on mobile
- Images scale properly
- Spacing proportional to screen size

Page-specific:
- Landing: single column at 375px, full-width CTAs
- Dashboard: single column at 375px, 2x2 quick stats grid
- Drone Management: stacked panels at 375px
- Race Results: card layout at 375px
- Leaderboard: stacked podium at 375px
- Marketplace: single column cards, filter overlay at 375px
```

**Verification:**
- Every page at every breakpoint: no overflow, readable, usable
- Mobile nav drawer works
- Test on actual phone or device emulator

---

### [x] TASK 6.1 — Error Handling & Edge Cases

> **Completion note (2026-04-13):** Most hardening work was either already in place from the service layer or pulled forward into earlier tasks.
>
> **Shipped:**
> 1. `app/not-found.jsx` — dark-themed 404, back-home link (added in 5.1).
> 2. `app/error.jsx` — client error boundary with Retry button (added in 5.1).
> 3. **Consistent API error format** via `lib/api/response.js` — every route uses `withApiHandler`, which catches `ApiError` instances and returns `{ error, details }` with the right status code, and any other thrown error becomes 500 `{ error: 'Internal server error' }`. Unauth is 401 `{ error: 'Not authenticated' }`.
> 4. **Zod validation** on every POST/PATCH body: `allocateStatsSchema`, `toggleDroneSchema`, `createListingSchema`, `buyListingSchema`, `updateAdminConfigSchema`, plus per-route ad-hoc schemas for `/api/skins/apply` and `/api/skins/remove`.
> 5. **Race-condition handling on marketplace buy:** `marketplace.service.js#buyListing` uses a conditional `UPDATE ... WHERE id = ? AND status = 'active'`. If zero rows are claimed, the buyer gets `410 This listing was just sold to someone else` instead of a half-committed purchase.
> 6. **Toast notifications** on stat save success/failure, drone toggle success/failure, marketplace buy / cancel / list outcomes (all wired through `useToast` — see `app/drones/[droneId]/page.jsx` and `app/marketplace/page.jsx`).
> 7. **Empty states** using `EmptyState`: `/drones` when the user has no drones, `/dashboard` spotlight when no active drone, `/marketplace` when listings are empty, `/races` / `DataTable` empty messages on the list and drone history tables.
> 8. **Input validation at write sites:** stat editor enforces cap/TSB/cost client-side so the API is a belt-and-braces validator; marketplace price input is `type="number"` and non-positive values are rejected by the Zod schema; search input is plain client-side filter.
> 9. **Session expiry** — any unauthenticated request to a protected route hits `proxy.js` and redirects to `/login?callbackUrl=…`, then NextAuth returns the user to the original URL after magic-link verification.
>
> **Deferred:** more ambitious retry/backoff on fetch failures, "Connection lost" toast on offline detection, and a Suspense-based global loading indicator — none of these are blockers for MVP. Current pages fall back to logging the error and showing the skeleton or empty state; the user can refresh to recover.

**Goal:** Harden the app.

**What Already Exists:** Fully functional, animated, responsive app.

**Instructions:**

```
1. app/not-found.jsx: dark themed 404 with "Page not found" + link home
2. app/error.jsx: error boundary with "Something went wrong" + retry button
3. Every API route: consistent error format { error: string, details?: any }
4. Every fetch: error state UI (not just console.error)
5. Toast notifications for: purchase success/failure, listing created/cancelled, stat save success/failure, toggle success/failure
6. Input validation: marketplace price > 0, stat editor checks, search input debounce
7. Race condition handling: buying already-sold listing shows "This item is no longer available"
8. Empty states for: no drones, no races, empty leaderboard, empty marketplace, no skins
9. Network error: "Connection lost" toast with retry
10. Session expiry: redirect to login gracefully
```

**Verification:**
- 404 page renders on invalid URLs
- Error boundary catches runtime errors
- All empty states render correctly
- Toast notifications work
- Race condition on buy shows friendly error

---

### [x] TASK 6.2 — SEO, Performance & Deployment

> **Completion note (2026-04-13):** Everything that doesn't require Captain's Vercel / GitHub credentials is shipped. Final deployment step is gated on Captain pushing to a repo + connecting Vercel.
>
> **Shipped:**
> - **SEO metadata:** landing page exports `metadata` with title, description, and `openGraph` (title/description/type). `/check-email` has a custom title. Root `layout.jsx` sets the base metadata. Dynamic pages (drone detail, race detail) inherit root metadata — real per-drone / per-race titles can be added as a follow-up once SSR is wired for those routes.
> - **`public/robots.txt`** — allows public routes, disallows `/api/` and `/admin/`, links to `/sitemap.xml`.
> - **`app/sitemap.js`** — Next.js native sitemap generator listing the two genuinely public routes (`/`, `/login`). Private screens are intentionally excluded.
> - **Cron deployment wiring:** `vercel.json` declares `{"crons":[{"path":"/api/races/run","schedule":"*/2 * * * *"}]}`. Vercel will hit the route with its own auth header; our handler accepts either `Authorization: Bearer <CRON_SECRET>` (Vercel default) or `x-cron-secret` (local scripts).
> - **Build & lint clean:** `npm run build` compiles all 25 routes (including `/sitemap.xml`) under Next 16 + Turbopack. `npm run lint` reports 0 errors / 0 warnings after naming the default export in `drizzle.config.js`.
>
> **Env vars documented in `.env.example`:** `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `RESEND_API_KEY`, `CRON_SECRET`. Neon connection is already pooled (`-pooler` subdomain in the URL). For production, Captain will need to set `NEXTAUTH_URL` to the deployed domain.
>
> **Still requires Captain action to actually ship to prod:**
> 1. Push the repo to GitHub.
> 2. Import into Vercel.
> 3. Set env vars in the Vercel dashboard (copy from `.env.local`, but flip `NEXTAUTH_URL` to `https://<deployed-domain>`).
> 4. Deploy. Vercel picks up `vercel.json` automatically and starts the 2-min cron.
> 5. Verify the race cycle fires in Vercel Function logs.
> 6. For real email delivery, verify a Resend domain and update the `from` in `lib/auth/index.js` (currently `onboarding@resend.dev` which only sends to the Resend account owner).
>
> **Deferred performance work** (not shipped, tracked for a follow-up pass): `next/image` on hero/drone imagery (currently inline SVG, already tiny), `dynamic()` imports for marketplace modals, explicit `Cache-Control` headers on `/api/races` / `/api/leaderboard`. None are MVP blockers.

**Goal:** Optimize and deploy to Vercel.

**What Already Exists:** Complete app.

**Instructions:**

```
1. SEO:
   - Each page exports metadata: title, description, openGraph
   - Landing page: full OG tags with image placeholder
   - Dynamic pages: metadata from data (e.g., drone name in title)
   - Create public/robots.txt (allow all)
   - Create app/sitemap.js that generates sitemap

2. Performance:
   - All images: Next.js Image component with width/height/sizes
   - Dynamic imports for heavy components (marketplace grid, race log detail)
   - Verify all database indexes from Part 3 exist
   - API routes: Cache-Control headers (races: 30s, leaderboard: 60s, tracks: 1hr)

3. Production env:
   - Verify .env.example documents all vars: DATABASE_URL, NEXTAUTH_URL, NEXTAUTH_SECRET, RESEND_API_KEY, CRON_SECRET
   - Neon: use pooled connection string

4. Build and verify:
   - npm run build — must succeed with no errors
   - npm run lint — must pass
   - Remove all console.log statements
   - No hardcoded localhost URLs anywhere
   - Test with npm start locally

5. Deploy:
   - Push to GitHub
   - Connect repo to Vercel
   - Set env vars in Vercel dashboard
   - Deploy
   - Verify cron runs (check Vercel Function logs)
   - Run complete user journey on production URL
```

**Verification:**
- Build succeeds
- Lighthouse: 90+ on Performance, Accessibility, Best Practices, SEO
- Pages load under 3 seconds
- Cron executes on schedule
- Full journey works on production

---

## PART 5: POST-LAUNCH CHECKLIST

- [ ] Run 50+ race cycles to populate data
- [ ] Create test accounts and simulate marketplace activity
- [ ] Tune economy via admin panel based on observed progression rates
- [ ] Monitor Vercel logs for errors
- [ ] Monitor Neon query performance
- [ ] Set up Resend with a real domain for email deliverability
- [ ] Share with initial users for feedback
- [ ] Plan Phase 2: race visual replay, tournaments, battle pass, MegaETH integration

---

## APPENDIX: MOCKUP REFERENCE

When executing screen tasks (4.1-4.6), paste the corresponding Gemini mockup image directly into the Claude Code session alongside the task instructions. The text descriptions in each task serve as spec backup, but the image is the primary design reference.

Mockup screens:
1. Landing page: dark bg, drone hero, How It Works, stats ticker, features grid, footer
2. Dashboard: multi-panel, drone spotlight, race feed, stats cards, countdown
3. Drone Management: two-panel (drone image left, stat editor right), performance summary, race history
4. Race Results: data table, filters, live indicator, weather/time icons, pagination
5. Leaderboard: podium top 3, ranking table, season info, rewards preview
6. Marketplace: tabs, filter sidebar, card grid, buy/sell flow, transaction history
