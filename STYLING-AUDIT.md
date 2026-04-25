# Drone Manager v2 – Styling Audit

Read-only audit of `/app/**` page styles, `/components/ui/**` primitive styles and `app/globals.css`. Citations use `path:line` format. All paths are absolute.

---

## 1. Globals dump

Source: `/home/aabaad/dev/dronemanager-v2/app/globals.css`

### Imported fonts (`globals.css:7`)
- `@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');`

### Custom properties on `:root` (`globals.css:9-110`)

| Group | Variable | Value |
|---|---|---|
| Backgrounds | `--bg-primary` | `#000000` |
| Backgrounds | `--bg-secondary` | `#0A0A0A` |
| Backgrounds | `--bg-card` | `#121212` |
| Backgrounds | `--bg-card-alt` | `#1A1A1A` |
| Backgrounds | `--bg-elevated` | `#1E1E1E` |
| Backgrounds | `--bg-input` | `#1E1E1E` |
| Borders | `--border-default` | `#3F3F3F` |
| Borders | `--border-subtle` | `#292929` |
| Borders | `--border-accent` | `#03DAC6` |
| Borders | `--header-bar-bg` | `#252525` |
| Borders | `--header-bar-text` | `#F0F0F0` |
| Accent Colors | `--accent-primary` | `#03DAC6` |
| Accent Colors | `--accent-secondary` | `#BB86FC` |
| Accent Colors | `--accent-error` | `#CF6679` |
| Accent Colors | `--accent-success` | `#03DAC6` |
| Accent Colors | `--accent-warning` | `#F5C518` |
| Rarity | `--rarity-common` | `#9E9E9E` |
| Rarity | `--rarity-rare` | `#4A9EFF` |
| Rarity | `--rarity-epic` | `#BB86FC` |
| Rarity | `--rarity-legendary` | `#FFD700` |
| Podium | `--podium-gold` | `#FFD700` |
| Podium | `--podium-silver` | `#C0C0C0` |
| Podium | `--podium-bronze` | `#CD7F32` |
| Level | `--level-steel` | `#8A9BA8` |
| Level | `--level-orange` | `#FF8C42` |
| Level | `--level-purple` | `#BB86FC` |
| Level | `--level-gold` | `#FFD700` |
| Text | `--text-primary` | `#FFFFFF` |
| Text | `--text-secondary` | `#A0A0A0` |
| Text | `--text-tertiary` | `#666666` |
| Text | `--text-accent` | `#03DAC6` |
| Fonts | `--font-heading` | `'Rajdhani', sans-serif` |
| Fonts | `--font-body` | `'Inter', sans-serif` |
| Fonts | `--font-mono` | `'JetBrains Mono', monospace` |
| Type Scale | `--text-xs` | `0.75rem` |
| Type Scale | `--text-sm` | `0.875rem` |
| Type Scale | `--text-base` | `1rem` |
| Type Scale | `--text-lg` | `1.125rem` |
| Type Scale | `--text-xl` | `1.25rem` |
| Type Scale | `--text-2xl` | `1.5rem` |
| Type Scale | `--text-3xl` | `1.875rem` |
| Type Scale | `--text-4xl` | `2.25rem` |
| Type Scale | `--text-5xl` | `3rem` |
| Type Scale | `--text-6xl` | `3.75rem` |
| Font Weights | `--font-normal` | `400` |
| Font Weights | `--font-medium` | `500` |
| Font Weights | `--font-semibold` | `600` |
| Font Weights | `--font-bold` | `700` |
| Spacing | `--space-1` | `0.25rem` |
| Spacing | `--space-2` | `0.5rem` |
| Spacing | `--space-3` | `0.75rem` |
| Spacing | `--space-4` | `1rem` |
| Spacing | `--space-5` | `1.25rem` |
| Spacing | `--space-6` | `1.5rem` |
| Spacing | `--space-8` | `2rem` |
| Spacing | `--space-10` | `2.5rem` |
| Spacing | `--space-12` | `3rem` |
| Spacing | `--space-16` | `4rem` |
| Spacing | `--space-20` | `5rem` |
| Border Radius | `--radius-sm` | `4px` |
| Border Radius | `--radius-md` | `8px` |
| Border Radius | `--radius-lg` | `12px` |
| Border Radius | `--radius-xl` | `16px` |
| Border Radius | `--radius-full` | `9999px` |
| Shadows | `--shadow-card` | `0 2px 8px rgba(0, 0, 0, 0.3)` |
| Shadows | `--shadow-elevated` | `0 4px 16px rgba(0, 0, 0, 0.4)` |
| Shadows | `--glow-teal` | `0 0 20px rgba(3, 218, 198, 0.15)` |
| Shadows | `--glow-purple` | `0 0 20px rgba(187, 134, 252, 0.15)` |
| Animation | `--duration-fast` | `150ms` |
| Animation | `--duration-normal` | `300ms` |
| Animation | `--duration-slow` | `500ms` |
| Animation | `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Animation | `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` |

### Global resets / base styles (`globals.css:116-148`)

- Universal `*, *::before, *::after { box-sizing: border-box; }` (line 116-120).
- `html { scroll-behavior: smooth; }` (line 122-124).
- `body` (line 126-137): `background: var(--bg-primary)`, `color: var(--text-primary)`, `font-family: var(--font-body)`, `font-size: var(--text-sm)` (0.875rem), `line-height: 1.6`.
- `h1-h6` (line 139-143): `font-family: var(--font-heading)`, `margin: 0`, `line-height: 1.2`.
- `a { color: inherit; text-decoration: none; }` (line 145-148).
- `::selection { background: rgba(3, 218, 198, 0.3); color: var(--text-primary); }` (line 200-203).

### Scrollbar (`globals.css:178-194`)
`::-webkit-scrollbar { width: 8px; height: 8px; }`, track `var(--bg-secondary)`, thumb `var(--border-subtle)` rounded `--radius-sm`, thumb hover `var(--accent-primary)`.

### Keyframes (global) (`globals.css:154-172`)
- `@keyframes droneHover` – translateY 0 → -4px → 0 (6s cycle pattern when used).
- `@keyframes shimmer` – background-position −200% → 200%.
- `@keyframes pulse` – opacity 1 → 0.5 → 1.
- `@keyframes fadeInUp` – opacity 0 + translateY(20px) → opacity 1 + translateY(0).

### Module-local keyframes
- `legendaryShimmer` defined four times — `dashboard/page.module.css:155`, `drones/page.module.css:456`, `drones/[droneId]/page.module.css:676`, `races/[raceId]/page.module.css:383`, `marketplace/page.module.css:599` (5 redundant copies). Each varies subtly in box-shadow / border-color values.
- `legendarySkinSweep` – `marketplace/page.module.css:635` (gradient sweep).
- `tickerPulse` – `marketplace/page.module.css:921`.
- `tapePulse` – `marketplace/page.module.css:2116`.
- `revealBurst`, `revealPulseEpic` – `marketplace/page.module.css:1935, 1945`.
- `bigCardFloat` – `marketplace/page.module.css:1609`.
- `rainbowSpin` – `marketplace/page.module.css:1381`.
- `bannerEnter` – `races/[raceId]/page.module.css:107`.
- `pulse` redefined locally – `RacingStatusPill.module.css:42`.
- `btnSpin` – `Button/Button.module.css:94`.
- `fadeIn`, `slideUp`, `fadeInOverlay`, `slideInLeft` – `Modal.module.css:79, 84`, `NavShell.module.css:275, 280`.
- `toastIn` – `Toast.module.css:42`.
- `shimmer` redefined inside `DataTable.module.css:139` (duplicates global).

### Reduced motion (`globals.css:233-240`)
Disables animations / transitions when `prefers-reduced-motion: reduce`.

### Utility class
- `.visually-hidden` (`globals.css:217-227`).

### Focus pattern (commented block, not active rule) (`globals.css:206-211`)
Documents the pattern `:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }` for components to opt in.

---

## 2. Font usage by context

Cited `file:line` referrers — text is the **resolved** value from each file. Only `app/...` and `components/ui/...` files searched.

### Page titles (h1)

| File:line | font-family | font-size | weight | line-height | letter-spacing | color |
|---|---|---|---|---|---|---|
| `app/page.module.css:131-139` `.heroHeading` | `--font-heading` | `--text-3xl` (mobile/tablet) → `--text-3xl` md+, override on small `--text-2xl` (line 487) | `--font-bold` | 1.05 | 0.01em | inherits `var(--text-primary)` |
| `app/login/page.module.css:22-31` `.title` | `--font-heading` | `--text-2xl` | `--font-bold` | (default 1.2) | 0.05em | `--accent-primary` |
| `app/check-email/page.module.css:28-36` `.title` | `--font-heading` | `--text-2xl` | `--font-bold` | (default 1.2) | 0.05em | `--text-primary` |
| `app/not-found.module.css:28-34` `.title` | `--font-heading` | `--text-2xl` | `--font-bold` | (default 1.2) | (none) | `--text-primary` |
| `app/profile/[userId]/page.module.css:1-13` `.placeholder` | `--font-heading` | `--text-2xl` | `--font-semibold` | (default 1.2) | 0.05em | `--text-primary` |
| `app/admin/page.module.css:1-13` `.placeholder` | `--font-heading` | `--text-2xl` | `--font-semibold` | (default 1.2) | 0.05em | `--text-primary` |
| `app/guide/page.module.css:12-20` `.pageTitle` | `--font-heading` | `--text-4xl` (down to `--text-3xl` ≤600px line 339) | `--font-bold` | (default 1.2) | 0.04em | `--text-primary` |
| `app/faq/page.module.css:12-20` `.pageTitle` | `--font-heading` | `--text-4xl` (down to `--text-3xl` ≤600px line 161) | `--font-bold` | (default 1.2) | 0.04em | `--text-primary` |
| `app/tracks/[trackId]/page.module.css:64-73` `.name` (track h1) | `--font-heading` | `--text-2xl` | `--font-bold` | 1.1 | 0.04em | `--text-primary` |

### Section headings (h2, h3)

| File:line | Selector | font-family | font-size | weight | letter-spacing | color |
|---|---|---|---|---|---|---|
| `app/page.module.css:199-206` `.sectionHeading` (landing) | `--font-heading` | `--text-2xl` | `--font-bold` | 0.01em | inherits `--text-primary` |
| `app/dashboard/page.module.css:49-59` `.sectionHeading` | **`--font-body`** | **`--text-sm`** | `--font-semibold` | 0.01em | `#F0F0F0` (literal); bg `#252525`; border-bottom `1px solid #3F3F3F` |
| `app/drones/[droneId]/page.module.css:319-334` `.sectionHeading` | `--font-body` | `--text-sm` | `--font-semibold` | 0.01em | `var(--header-bar-text)` (#F0F0F0); bg `var(--header-bar-bg)`; min-height 44px |
| `app/races/[raceId]/page.module.css:223-238` `.sectionHeading` | `--font-body` | `--text-sm` | `--font-semibold` | 0.01em | `--header-bar-text`; bg `--header-bar-bg`; min-height 44px |
| `app/tracks/[trackId]/page.module.css:183-194` `.sectionHead` | **`--font-mono`** | **`10px`** | `--font-bold` | 0.14em | `--text-secondary`, bg `--bg-card-alt` |
| `app/guide/page.module.css:170-184` `.sectionHeading` | `--font-body` | `--text-base` | `--font-semibold` | 0.02em | `#F0F0F0` (literal); bg `#252525` |
| `app/faq/page.module.css:53-64` `.sectionHeading` | `--font-body` | `--text-base` | `--font-semibold` | 0.02em | `#F0F0F0` (literal); bg `#252525` |
| `app/marketplace/page.module.css:2121-2129` `.tapeTitle` | `--font-body` | `--text-sm` | `--font-semibold` | 0.02em | `--header-bar-text` |
| `app/page.module.css:251-257` `.stepTitle` (landing h3) | `--font-heading` | `--text-2xl` | `--font-semibold` | (none) | `--text-primary` |
| `app/page.module.css:358-364` `.featureTitle` (landing h3) | `--font-heading` | `--text-xl` | `--font-semibold` | (none) | `--text-primary` |
| `app/guide/page.module.css:195-203` `.subheading` | `--font-heading` | `--text-base` | `--font-semibold` | 0.04em | `--text-primary` |
| `app/marketplace/page.module.css:1093-1102` `.packName` (h3) | `--font-heading` | `--text-lg` (hero `--text-2xl` :1104; compact `--text-base` :1109) | `--font-bold` | 0.03em | `--text-primary` |

### Card titles

| File:line | Selector | font-family | font-size | weight | letter-spacing | color |
|---|---|---|---|---|---|---|
| `app/dashboard/page.module.css:175-183` `.droneName` | `--font-heading` | `--text-xl` | `--font-bold` | 0.03em | `--text-primary` |
| `app/drones/page.module.css:477-490` `.droneName` (card) | `--font-heading` | `--text-base` | `--font-bold` | 0.04em | `--text-primary` |
| `app/drones/[droneId]/page.module.css:81-90` `.droneName` | `--font-heading` | `--text-base` (mobile `--text-lg` :347-348) | `--font-bold` | 0.03em | `--text-primary` |
| `app/races/[raceId]/page.module.css:425-438` `.droneName` | `--font-heading` | `--text-xl` (mobile `--text-lg` :797-799) | `--font-bold` | 0.03em | `--text-primary` |
| `app/leaderboard/page.module.css:427-440` `.podiumName` | `--font-heading` | `--text-sm` (first place `--text-base` :443) | `--font-bold` | 0.03em | `--text-primary` |
| `app/marketplace/page.module.css:691-704` `.listingName` | `--font-heading` | `12px` | `--font-bold` | 0.03em | `--text-primary` |
| `app/marketplace/page.module.css:2233-2244` `.tapeName` | `--font-heading` | `12px` | `--font-bold` | 0.03em | `--text-primary` |
| `app/marketplace/page.module.css:1964-1972` `.revealName` | `--font-heading` | `--text-sm` | `--font-bold` | 0.03em | `--text-primary` |
| `app/drones/page.module.css:58-66` `.topPerfName` | `--font-heading` | `--text-base` | `--font-bold` | 0.04em | `--text-primary` |
| `app/tracks/page.module.css:72-81` `.name` (track card) | `--font-heading` | `--text-lg` | `--font-bold` | 0.04em | `--text-primary` |
| `app/marketplace/page.module.css:1794-1807` `.possibleName` | `--font-heading` | `10px` | `--font-bold` | 0.05em | `--text-primary` |
| `app/races/[raceId]/page.module.css:160-168` `.headlineWinner` | `--font-heading` | `--text-sm` (mobile `--text-xs` :800-802) | `--font-bold` | 0.03em | `--text-primary` |

### Card body text

| File:line | Selector | family | size | color |
|---|---|---|---|---|
| `app/page.module.css:272-278` `.stepDescription` | `--font-body` | `--text-sm` | `--text-secondary` (line-height 1.6) |
| `app/page.module.css:366-372` `.featureDescription` | `--font-body` | `--text-sm` | `--text-secondary` |
| `app/dashboard/page.module.css:730-735` `.empty` | `--font-body` | `--text-sm` | `--text-tertiary` |
| `app/guide/page.module.css:209-215` `.paragraph` | `--font-body` | `--text-sm` | `--text-secondary` (1.7) |
| `app/faq/page.module.css:141-149` `.answer` | `--font-body` | `--text-sm` weight `--font-normal` | `--text-secondary` (1.7) |
| `app/marketplace/page.module.css:1507-1514` `.heroDescription` | `--font-body` | `13px` | `--text-secondary` (1.55) |
| `app/marketplace/page.module.css:1151-1158` `.packContents` | `--font-mono` | `11px` | `--text-secondary` (1.55) |

### Table headers

| File:line | family | size | weight | color | bg |
|---|---|---|---|---|---|
| `components/ui/DataTable/DataTable.module.css:15-27` `.th` | `--font-body` | `11px` | `--font-medium` | `#A0A0A0` (literal) | `transparent`, border-bottom `1px solid var(--border-default)` |
| `app/dashboard/page.module.css:665-683` `.resultsHeader` | `--font-body` | `11px` | `--font-medium` | `#A0A0A0` | `transparent`, border-bottom `1px solid #3F3F3F` |
| `app/guide/page.module.css:265-283` `.costHeader` | `--font-body` | `--text-xs` | `--font-semibold` | `--text-primary` (uppercase 0.04em) | `--bg-card-alt` |

### Table cell text

| File:line | family | size | color |
|---|---|---|---|
| `components/ui/DataTable/DataTable.module.css:91-96` `.td` | (inherits `--font-body`) | `11px` (`10px` ≤768px :108) | `--text-primary` |
| `app/dashboard/page.module.css:665-673` `.resultsRow` | (inherits) | `11px` (`10px` mobile :809-811) | `--text-primary` |
| `app/races/page.module.css:149-160` `.droneCell` | `--font-body` | `11px` (mobile 10px) | `--text-primary` |
| `app/races/page.module.css:143-147` `.mono` (cell) | `--font-mono` | `11px` | `--text-secondary` |
| `app/leaderboard/page.module.css:508-512` `.nameCell` | `--font-body` | inherit (11px) | `--text-primary` weight `--font-semibold` |
| `app/tracks/[trackId]/page.module.css:281-302` `.matchupName` | `--font-mono` | `12px` | `--text-secondary` |
| `app/tracks/[trackId]/page.module.css:305-310` `.winnerTag` | `--font-mono` | `12px` | `--accent-primary` weight `--font-bold` |

### Stat numbers / data values (mono numeric)

| File:line | Selector | family | size | weight | color |
|---|---|---|---|---|---|
| `app/page.module.css:310-317` `.statValue` (landing ticker) | `--font-mono` | `3.5rem` (mobile `2.25rem` :528-530) | `--font-bold` | `--accent-primary` |
| `app/dashboard/page.module.css:382-389` `.statValue` | `--font-mono` | `--text-xs` | `--font-bold` | `--text-primary` |
| `app/dashboard/page.module.css:516-520` `.countdownUnit` | `--font-mono` | `--text-3xl` | inherits bold | `--text-primary` |
| `app/dashboard/page.module.css:601-608` `.quickValue` | `--font-mono` | `--text-lg` (tablet `--text-base` :816-817; mobile `--text-base` :802-804) | (children bold) | mixed |
| `app/drones/page.module.css:158-164` `.fleetStatValue` | `--font-mono` | `13px` (mobile `12px` :646-648) | `--font-bold` | `--text-primary` |
| `app/drones/page.module.css:557-562` `.kpiValue` | `--font-mono` | `12px` | `--font-bold` | `--text-primary` |
| `app/drones/[droneId]/page.module.css:469-474` `.metaKpiValue` | `--font-mono` | `--text-sm` | `--font-medium` | `--text-secondary` |
| `app/drones/[droneId]/page.module.css:221-226` `.statStripValue` | `--font-mono` | `--text-xs` | `--font-medium` | `--text-secondary` |
| `app/marketplace/page.module.css:801-810` `.price` | `--font-mono` | `14px` | `--font-bold` | `--accent-primary` |
| `app/marketplace/page.module.css:1122-1129` `.packPrice` | `--font-mono` | `--text-base` (hero `--text-xl` :1131; compact `--text-sm` :1137) | `--font-bold` | `--text-primary` (hero `--rarity-legendary`) |
| `app/marketplace/page.module.css:2144-2149` `.tapeStatValue` | `--font-mono` | `13px` | `--font-bold` | `--text-primary` |
| `app/marketplace/page.module.css:2253-2262` `.tapePrice` | (inherits font-mono) | `12px` | `--font-bold` | `--accent-primary` |
| `app/leaderboard/page.module.css:480-485` `.podiumStatRow dd` | `--font-mono` | `11px` | `--font-medium` | `--text-secondary` |
| `app/tracks/[trackId]/page.module.css:235-241` `.statValue` (track stat) | `--font-mono` | `--text-lg` | `--font-bold` | `--text-primary` |
| `app/races/[raceId]/page.module.css:635-639` `.trackStatValue` | `--font-mono` | `--text-sm` | `--font-medium` | `--text-secondary` |
| `app/leaderboard/page.module.css:579-583` `.yourRankValue` | (inherits font-mono) | `--text-sm` | `--font-bold` | `--accent-primary` |
| `app/marketplace/page.module.css:80-91` `.balanceValue` | (inherits font-mono) | `--text-sm` | `--font-bold` | `--accent-primary` |
| `app/marketplace/page.module.css:1584-1595` `.bigCardL` | `--font-heading` (oddly mono-styled) | `140px` | `--font-bold` | `--rarity-legendary` |

### Labels and captions (small uppercase labels above values)

| File:line | Selector | family | size | weight | letter-spacing | color |
|---|---|---|---|---|---|---|
| `app/page.module.css:319-325` `.statLabel` (landing) | `--font-body` | `--text-xs` | (default 400) | 0.15em | `--text-secondary` |
| `app/dashboard/page.module.css:593-599` `.quickLabel` | `--font-mono` | `--text-xs` (tablet `10px` :820) | (none) | 0.03em | `--text-secondary` |
| `app/dashboard/page.module.css:354-363` `.statRowLabel` | `--font-mono` | `--text-xs` | (none) | 0.05em | `#E5E5E5` literal |
| `app/dashboard/page.module.css:306-315` `.kpiCell dt` | `--font-mono` | `--text-xs` | `--font-semibold` | 0.05em | `--text-primary` |
| `app/dashboard/page.module.css:317-324` `.kpiCell dd` | `--font-mono` | `--text-sm` | `--font-medium` | (none) | `--text-secondary` |
| `app/dashboard/page.module.css:522-528` `.countdownLabel` | (inherits mono) | `10px` | `--font-medium` | 0.1em | `--text-tertiary` |
| `app/drones/page.module.css:46-56` `.topPerfHeader` | `--font-mono` | `9px` | `--font-bold` | 0.1em | `--accent-primary` |
| `app/drones/page.module.css:150-156` `.fleetStatLabel` | `--font-mono` | `9px` (mobile `8px` :649-651) | (none) | 0.08em | `--text-tertiary` |
| `app/drones/page.module.css:549-555` `.kpiLabel` | `--font-mono` | `9px` | (none) | 0.08em | `--text-tertiary` |
| `app/drones/page.module.css:357-374` `.activeRibbon` | `--font-mono` | `9px` | `--font-bold` | 0.1em | `--accent-primary` |
| `app/drones/[droneId]/page.module.css:212-219` `.statStripLabel` | `--font-mono` | `--text-xs` | `--font-semibold` | 0.05em | `--text-primary` |
| `app/drones/[droneId]/page.module.css:151-156` `.formLabel` | `--font-mono` | `--text-xs` | `--font-semibold` | 0.08em | `--text-secondary` |
| `app/drones/[droneId]/page.module.css:460-467` `.metaKpiLabel` | `--font-mono` | `--text-xs` | `--font-semibold` | 0.05em | `--text-primary` |
| `app/leaderboard/page.module.css:572-577` `.yourRankLabel` | (inherits mono) | `--text-xs` (mobile `10px` :669-671) | (none) | 0.08em | `--text-secondary` |
| `app/leaderboard/page.module.css:471-478` `.podiumStatRow dt` | (inherits mono) | `10px` | `--font-semibold` | 0.05em | `--text-primary` |
| `app/leaderboard/page.module.css:391-398` `.podiumRankLabel` | `--font-mono` | `10px` | `--font-bold` | 0.12em | tier-colored (gold/silver/bronze) |
| `app/marketplace/page.module.css:70-74` `.balanceLabel` | (inherits mono) | `10px` | `--font-semibold` | (inherits 0.08em) | `--text-secondary` |
| `app/marketplace/page.module.css:706-712` `.listingLevel` | `--font-mono` | `9px` | `--font-bold` | 0.05em | (inline level color) |
| `app/marketplace/page.module.css:756-762` `.statBarLabel` | `--font-mono` | `8px` | `--font-semibold` | 0.05em | `--text-secondary` |
| `app/marketplace/page.module.css:1685-1691` `.possibleLabel` | `--font-mono` | `10px` | (none) | 0.12em | `--text-tertiary` |
| `app/marketplace/page.module.css:2150-2155` `.tapeStatLabel` | `--font-mono` | `9px` | (none) | 0.08em | `--text-tertiary` |
| `app/tracks/page.module.css:165-170` `.specLabel` | (inherits mono) | `9px` | (none) | 0.08em | `--text-tertiary` |
| `app/tracks/[trackId]/page.module.css:227-233` `.statLabel` | `--font-mono` | `9px` | (none) | 0.1em | `--text-tertiary` |
| `app/races/[raceId]/page.module.css:629-633` `.trackStatLabel` | (inherits mono) | `--text-xs` | `--font-semibold` | (inherits) | `--text-primary` |
| `app/races/page.module.css:34-38` `.totalRacesLabel` | `--font-body` | `--text-xs` | (default) | (none) | `--text-secondary` |
| `app/login/page.module.css:53-59` `.labelText` | `--font-mono` | `--text-xs` | (none) | 0.05em | `--text-secondary` |

### Buttons (variants)

`components/ui/Button/Button.module.css`:
- `.button` base (line 1-17): `font-family: --font-body`, `font-weight: --font-semibold`, `border-radius: --radius-md`, `border: none`, `text-transform: uppercase`, `letter-spacing: 0.05em`, `line-height: 1`.
- Sizes — `.sm`: `font-size --text-xs`, padding `--space-2 --space-3`, min-height `32px` (line 62-66). `.md`: `font-size --text-sm`, padding `--space-3 --space-5`, min-height `40px` (line 67-71). `.lg`: `font-size --text-base`, padding `--space-4 --space-6`, min-height `48px` (line 72-76).
- **Primary** (line 38-41): bg `var(--accent-primary)`, color `#000`. (No hover defined; relies on `transition: all` only.)
- **Secondary** (line 43-47): bg `transparent`, color `--text-primary`, `border: 1px solid var(--border-subtle)`.
- **Danger** (line 49-52): bg `--accent-error`, color `#000`.
- **Ghost** (line 54-58): bg `transparent`, color `--text-secondary`, `border: none`.
- Disabled (line 28-30): `cursor: not-allowed` (no opacity change in primitive).
- `:focus-visible`: `outline: 2px solid var(--accent-primary); outline-offset: 2px` (line 19-22).
- Active (non-disabled): `transform: scale(0.98)` (line 24-26).

#### Per-page custom buttons (don't go through primitive)

| File:line | Selector | bg | color | border | radius | padding | font |
|---|---|---|---|---|---|---|---|
| `app/page.module.css:63-82` `.navCta` | `--accent-primary` | `#000` | none | `--radius-md` | `--space-3 --space-5` | `--font-body --text-sm --font-semibold` uppercase 0.05em |
| `app/page.module.css:150-176` `.primaryBtn` | `--accent-primary` | `#000` | none | `--radius-full` | `--space-4 --space-8` | `--font-body --text-base --font-semibold` |
| `app/page.module.css:178-187` `.secondaryBtn` | transparent | `--text-primary` | `1px solid --border-subtle` | `--radius-full` | `--space-4 --space-8` | (same as primary) |
| `app/drones/page.module.css:263-282` `.segBtn` | transparent | `--text-secondary` | none | `--radius-sm` | `4px 10px` | `--font-body 11px --font-medium` |
| `app/marketplace/page.module.css:36-58` `.tab` | transparent | `--text-secondary` | none | `--radius-sm` | `3px 12px` | `--font-mono 10px --font-semibold` uppercase 0.08em |
| `app/marketplace/page.module.css:111-132` `.viewTab` | transparent | `--text-secondary` | none | (none) | `2px 0` | `--font-mono 10px --font-medium` |
| `app/marketplace/page.module.css:1405-1444` `.packBtn` / `.packBtnGold` | `--rarity-legendary` (gold) or per-variant | `#000` | `1px solid --rarity-legendary` | (inherits Button) | (inherits Button) | inherits Button + width 240px, letter-spacing 0.05em |
| `app/marketplace/page.module.css:2015-2028` `.pageNum` | transparent | `--text-secondary` | `1px solid transparent` | `--radius-sm` | `0 10px` height 32px | `--font-mono --text-sm --font-medium` |
| `app/marketplace/page.module.css:2049-2067` `.pageNext` | transparent | `--text-secondary` | `1px solid --border-subtle` | `--radius-sm` | width 32px height 32px | (icon only) |
| `app/marketplace/page.module.css:2346-2363` `.typeBtn` | transparent | `--text-secondary` | none | `--radius-sm` | `4px 14px` | `--font-mono 10px --font-semibold` uppercase 0.08em |
| `app/leaderboard/page.module.css:197-218` `.tab` | transparent | `--text-secondary` | none | `--radius-sm` | `3px 10px` | `--font-mono 10px --font-semibold` |
| `app/leaderboard/page.module.css:241-262` `.bracketTab` | transparent | `--text-secondary` | none | (none) | `2px 0` | `--font-mono 9px --font-medium` |
| `app/leaderboard/page.module.css:691-715` `.pageNum` | transparent | `--text-secondary` | `1px solid transparent` | `--radius-sm` | `0 10px` height 32px | `--font-mono --text-sm --font-medium` |
| `app/leaderboard/page.module.css:725-747` `.pageNext` | transparent | `--text-secondary` | `1px solid --border-subtle` | `--radius-sm` | width/height 32px | (icon) |
| `app/races/page.module.css:241-265` `.pageNum` | (same as leaderboard / marketplace pageNum) | | | | | |
| `app/races/page.module.css:275-296` `.pageNext` | (same pattern) | | | | | |
| `app/dashboard/page.module.css:198-216` `.navBtn` | `--bg-elevated` | `--text-secondary` | `1px solid --border-subtle` | `--radius-sm` | width 26px height 26px | (icon only) |
| `app/drones/[droneId]/page.module.css:576-602` `.buyButton` | `--accent-primary` | `#000` | none | `--radius-sm` | `3px 8px` | `--font-mono 10px --font-semibold` uppercase 0.04em |
| `app/marketplace/page.module.css:843-850` `.cardBtn` | (inherits Button primitive) | | | | min-height 24px, padding `4px 6px`, font-size `9.5px`, letter-spacing 0.02em | (overrides Button sizing) |
| `app/marketplace/page.module.css:408-424` `.clearBtn` | transparent | `--text-primary` | none | (none) | `2px 0` | `--font-body 11px` |
| `app/marketplace/page.module.css:1209-1227` `.packDetailsToggle` | transparent | `--text-tertiary` | none | (none) | `2px 0` | `--font-mono 10px` |
| `components/ui/StatEditorRow/StatEditorRow.module.css:61-109` `.btn` | `--bg-elevated` | `--text-primary` | `1px solid --border-subtle` | `--radius-sm` (corners only on first/last) | `26x24px` | (icon button) |
| `components/ui/Modal/Modal.module.css:49-66` `.closeBtn` | transparent | `--text-secondary` | none | `--radius-md` | `36x36px` | (icon) |
| `components/ui/NavShell/NavShell.module.css:116-146` `.signIn` / `.signOut` | transparent | `--text-secondary` | `1px solid #3F3F3F` | `--radius-sm` | `8px 14px` | `--font-body --text-xs --font-medium` uppercase 0.05em |

### Nav links

| File:line | family | size | weight | color | active state |
|---|---|---|---|---|---|
| `components/ui/NavShell/NavShell.module.css:54-80` `.link` | `--font-body` | `--text-sm` | `--font-medium` | `--text-secondary`; hover `--text-primary` w/ bg `rgba(255,255,255,0.04)` | `.linkActive`: color `--accent-primary`, bg `rgba(3,218,198,0.12)` |
| `app/page.module.css:51-61` `.navLinks a` (landing) | `--font-body` | `--text-sm` | `--font-medium` | `--text-secondary`; hover `--accent-primary` |  |
| `app/guide/page.module.css:128-151` `.tocLink` | `--font-body` | `--text-sm` | `--font-medium` | `--text-secondary`; active color `--accent-primary` w/ left border 2px | active border-left `--accent-primary` |

### Tab / pill menu items (active and inactive)

| File:line | Variant | Inactive | Active |
|---|---|---|---|
| `app/marketplace/page.module.css:36-58` `.tab` / `.tabActive` | mono 10px semibold uppercase 0.08em | color `--text-secondary` | bg `--bg-elevated`, color `--accent-primary` |
| `app/marketplace/page.module.css:111-132` `.viewTab` / `.viewTabActive` | mono 10px medium uppercase 0.08em | `--text-secondary` | color `--accent-primary`, weight `--font-bold` |
| `app/leaderboard/page.module.css:197-219` `.tab` | mono 10px semibold | `--text-secondary` | bg `--bg-elevated`, color `--accent-primary` |
| `app/leaderboard/page.module.css:241-263` `.bracketTab` | mono 9px medium | `--text-secondary` | color `--accent-primary`, weight `--font-bold` |
| `app/drones/page.module.css:263-282` `.segBtn` | body 11px medium | `--text-secondary` | bg `rgba(3,218,198,0.15)`, color `--accent-primary` |
| `app/marketplace/page.module.css:2346-2363` `.typeBtn` | mono 10px semibold | `--text-secondary` | bg `--bg-elevated`, color `--accent-primary` |

### Filter / toggle labels

| File:line | family | size | color |
|---|---|---|---|
| `components/ui/FilterBar/FilterBar.module.css:23-30` `.fieldLabel` | `--font-body` | `--text-xs` | `--text-secondary` weight `--font-medium` |
| `app/marketplace/page.module.css:229-235` `.filterLabel` | `--font-body` | `11px` | `--text-primary` weight `--font-medium` |
| `app/leaderboard/page.module.css:271-277` `.botsToggleLabel` | `--font-mono` | `10px` | `--text-secondary` |
| `components/ui/Toggle/Toggle.module.css:10-15` `.label` | (inherits `--font-body`) | `--text-sm` | `--text-secondary` |
| `app/drones/[droneId]/page.module.css:405-412` `.activeLabel` | `--font-mono` | `--text-xs` | `#E5E5E5` (literal) weight `--font-medium` |
| `app/drones/page.module.css:293-295` `.sortLabel` | (parent body 11px) | inherits | `--text-secondary` |

### Badge text

`components/ui/Badge/Badge.module.css:1-14`: `font-family: var(--font-mono); font-size: var(--text-xs); font-weight: var(--font-medium); text-transform: uppercase; letter-spacing: 0.05em; padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm)`. Background per variant uses 15% rgba of color, foreground = full color.

Independent badge-like text usage (without primitive):
- `app/drones/page.module.css:601-612` `.skinRarityLabel` mono 9px bold uppercase 0.08em.
- `app/marketplace/page.module.css:716-739` `.rarityTag` mono 8px bold uppercase 0.08em.
- `app/marketplace/page.module.css:1809-1815` `.possibleRarity` mono 9px bold uppercase 0.1em.
- `app/marketplace/page.module.css:1635-1645` `.pill` mono 9px bold uppercase 0.1em.

### Tooltip text

No dedicated tooltip styles — pages rely on native `title` attributes only (e.g. `app/drones/page.jsx:260` `title={…}` on tier swatches; `app/drones/[droneId]/page.jsx:537` `title="…"` on `.activeHelp`). **(no tooltip component found)**.

### Empty state text

`components/ui/EmptyState/EmptyState.module.css`:
- `.title` (line 16-22): `--font-heading` `--text-xl` `--font-semibold` `--text-secondary`.
- `.description` (line 24-30): `--font-body` `--text-sm` `--text-tertiary` (max-width 420px).
- `.icon` (line 12-14): `--text-tertiary`.

DataTable empty state: `components/ui/DataTable/DataTable.module.css:117-122` `.empty` — center, `--text-tertiary`, `--text-sm`, padding `--space-10`.

### Footer text

Only on landing page (`app/page.module.css:391-433`):
- `.footerLogo` (line 402-412): `--font-heading` `--text-base` `--font-bold` `--text-secondary` uppercase 0.05em.
- `.footerLinks a` (line 422-433): `--font-body` `--text-xs` `--text-tertiary` uppercase 0.05em; hover `--accent-primary`.

No app-shell footer exists. Logged-in pages have **no footer** (the only candidate is the leaderboard sticky "Your Rank" bar).

---

## 3. Card styles

### Card primitive default (`components/ui/Card/Card.module.css:1-13`)
`.card`:
- `background: var(--bg-card)` (#121212)
- `border: 1px solid var(--border-default)` (#3F3F3F)
- `border-radius: var(--radius-lg)` (12px)
- `box-shadow: var(--shadow-card)` (0 2px 8px rgba(0,0,0,0.3))
- `color: var(--text-primary)`
- `overflow: hidden`
- `transition: all var(--duration-normal) var(--ease-out)`

`.hover` opt-in (`Card.module.css:24-27`): hover → `border-color: var(--border-accent)`, `box-shadow: var(--glow-teal), var(--shadow-card)`.

`.interactive` (when `onClick` is set; renders as `<button>`) (`Card.module.css:15-22`): `cursor: pointer`; `:focus-visible` outline 2px `--accent-primary`.

### Per-page Card overrides / card-like surfaces

| File:line | Selector | bg | border | radius | padding | shadow | hover |
|---|---|---|---|---|---|---|---|
| `app/page.module.css:228-240` `.step` (landing) | `--bg-card` | `1px solid --border-default` | `--radius-lg` | `32px` | `--shadow-card` | (none) |
| `app/page.module.css:337-352` `.featureCard` | `--bg-card` | `1px solid --border-default` | `--radius-lg` | `32px` | `--shadow-card` | hover `border-color: --border-accent` |
| `app/dashboard/page.module.css:87-91` `.spotlight` (Card override) | (inherits Card) | overridden `border-color: #3F3F3F` (literal) | inherits | inherits | inherits | none |
| `app/dashboard/page.module.css:395-400` `.liveFeed` | (inherits Card) | `border-color: #3F3F3F` | inherits | inherits | inherits | n/a |
| `app/dashboard/page.module.css:488-492` `.countdownCard` | (inherits Card) | `border-color: #3F3F3F` | inherits | inherits | inherits | n/a |
| `app/dashboard/page.module.css:564-568` `.quickStatsCard` | (inherits Card) | `border-color: #3F3F3F` | inherits | inherits | inherits | n/a |
| `app/dashboard/page.module.css:624-629` `.results` | (inherits Card) | `border-color: #3F3F3F` | inherits | inherits | inherits | n/a |
| `app/drones/page.module.css:343-353` `.droneCard` | `--bg-card` (overridden by `.level_*` tints) | `1px solid --border-default` (overridden by `.level_*` to 2px coloured) | `--radius-lg` | (no padding; inner sections set their own) | `--shadow-card` | per-tier border-color hover |
| `app/drones/[droneId]/page.module.css:33-38` `.leftPanel` (Card) | `--bg-card` | `1px solid --border-default` | (inherits Card) | (inner padding) | (inherits Card) | n/a |
| `app/drones/[droneId]/page.module.css:299-304` `.rightPanel` | `--bg-card` | `1px solid --border-default` | (inherits) | (inner) | (inherits) | n/a |
| `app/drones/[droneId]/page.module.css:442-448` `.perfSummaryCard` | `--bg-card` | `1px solid --border-default` | (inherits) | (inner) | (inherits) | n/a |
| `app/drones/[droneId]/page.module.css:539-542` `.historyCard` | `--bg-card` | `1px solid --border-default` | (inherits) | (no padding) | (inherits) | n/a |
| `app/races/[raceId]/page.module.css:278-281` `.gapCard` | `--bg-card` | `1px solid --border-default` | (inherits) | (inner) | (inherits) | n/a |
| `app/races/[raceId]/page.module.css:297-303` `.droneCard` | `--bg-card` | `1px solid --border-default` (overridden by level_*) | (inherits) | (inner) | (inherits) | per-tier hover border-color + glow |
| `app/races/[raceId]/page.module.css:547-552` `.trackCard` | `--bg-card` | `1px solid --border-default` | (inherits) | (sectioned) | (inherits) | n/a |
| `app/races/[raceId]/page.module.css:667-670` `.logCard` | `--bg-card` | `1px solid --border-default` | (inherits) | (inner) | (inherits) | n/a |
| `app/races/[raceId]/page.module.css:94-105` `.headlineBanner` | `--bg-card` | `1px solid --border-default` | `--radius-lg` | `--space-2 --space-4` | (none) | (anim only) |
| `app/leaderboard/page.module.css:293-313` `.podiumCard` | `--bg-card` (overridden by `.gold/.silver/.bronze` tints) | `2px solid --border-default` (overridden) | `--radius-md` | `--space-3` | per tier glow shadow | hover translateY(-2px) when link |
| `app/marketplace/page.module.css:457-470` `.listingCard` | `--bg-card` (overridden by rarity / level tint chains) | `1px solid --border-default` (overridden) | (inherits Card) | (inner) | (inherits Card) | hover `border-color: rgba(3,218,198,0.4)` |
| `app/marketplace/page.module.css:969-998` `.packCard` | `--bg-card` (per `.pack_*`) | `1px solid --border-default` (overridden) | `--radius-lg` | `18px 22px` (hero `48px 40px 36px`; compact `14px 18px`) | per-variant glow (gold) | (none) |
| `app/marketplace/page.module.css:1699-1724` `.possibleCard` | `--bg-elevated` | `1px solid --border-subtle` (per rarity) | `--radius-sm` | `10px 8px 8px` | rarity glow | none |
| `app/marketplace/page.module.css:1905-1924` `.revealCard` | `--bg-card` | `1px solid --border-default` | `--radius-md` | `--space-3` | (rarity anim) | n/a |
| `app/marketplace/page.module.css:2080-2086` `.tapeSection` | `--bg-card` | `1px solid --border-default` | `--radius-lg` | (inner) | (none) | n/a |
| `app/marketplace/page.module.css:209-214` `.filtersInner` | `--bg-card` | `1px solid --border-default` | `--radius-md` | (inner) | (none) | n/a |
| `app/marketplace/page.module.css:886-899` `.ticker` | `--bg-card` | `1px solid --border-default` | `--radius-md` | `10px 18px` | (none) | n/a |
| `app/tracks/page.module.css:36-44` `.card` (track list) | `--bg-card` | `1px solid --border-default` | `--radius-lg` | (no padding) | (none — explicit no shadow) | (no hover) |
| `app/tracks/[trackId]/page.module.css:178-198` `.sectionCard` | (inherits Card) | (inherits) | (inherits) | `padding: 0` (overrides primitive's none) | (inherits) | n/a |
| `app/login/page.module.css:12-20` `.card` | `--bg-card` | `1px solid --border-subtle` (NB: subtle, not default) | `--radius-lg` | `--space-10 --space-8` | `--shadow-elevated, --glow-teal` | n/a |
| `app/check-email/page.module.css:12-21` `.card` | `--bg-card` | `1px solid --border-subtle` | `--radius-lg` | `--space-10 --space-8` | `--shadow-elevated` | n/a |
| `app/not-found.module.css:10-22` `.card` | `--bg-card` | `1px solid --border-subtle` | `--radius-lg` | `--space-10 --space-8` | (none) | n/a |
| `app/drones/page.module.css:19-44` `.topPerformer` | gradient + `--bg-card` | `1px solid rgba(3,218,198,0.4)` | `--radius-md` | `10px 14px` | (none) | hover border glow |
| `app/drones/page.module.css:88-98` `.fleet` | `--bg-card` | `1px solid --border-default` | `--radius-md` | `--space-3 --space-4` | (none) | n/a |

---

## 4. Table styles

### DataTable primitive (`components/ui/DataTable/DataTable.module.css`)
- Wrapper bg `--bg-card` (`:1-5`).
- Header cell `.th`: padding `7px 12px`, body 11px medium, color `#A0A0A0` (literal), border-bottom `1px solid --border-default`, transparent bg.
- Row `.row`: border-bottom `1px solid --border-default`, transparent.
- **Alt row stripe** (`:75-77`): `tr:nth-child(even) { background: rgba(255, 255, 255, 0.02); }`.
- Row hover (`.rowInteractive:hover`, `:87-89`): `background: rgba(3, 218, 198, 0.06)`.
- Cell `.td`: padding `7px 12px` (`6px 10px` ≤1024px, `5px 8px` ≤768px), font-size `11px` (`10px` mobile), color `--text-primary`.
- Sortable hover (`:56-58`): `color: --accent-primary`.

### Custom dashboards results table (`app/dashboard/page.module.css:638-700`)
- Grid layout (not `<table>`), columns `1.2fr 1.5fr 80px 110px`.
- Header bg `transparent`, border-bottom `1px solid #3F3F3F` (literal), font 11px medium `#A0A0A0`.
- Row border-bottom `1px solid #3F3F3F`, hover `background: rgba(3, 218, 198, 0.06)`.
- Padding `7px var(--space-4)` (`5px 8px` mobile).
- **No alt-row striping** (differs from DataTable).

### Race log table (`app/races/[raceId]/page.module.css:283-287`)
Uses primitive DataTable; no custom overrides on table itself.

### Leaderboard rankings table (`app/leaderboard/page.module.css:491-535`)
Uses primitive DataTable; `.rankingsTable` wrapper sets `background: transparent`, `max-width: 960px`. `.myRow` highlight `background: rgba(3,218,198,0.09) !important; outline: 1px solid rgba(3,218,198,0.45)`.

### Live race feed (`app/dashboard/page.module.css:430-482`)
Not a table but row-based list: alt-row stripe `.feedRow:nth-child(even) { background: #252525; }` (line 448-450), hover `rgba(3,218,198,0.12)`.

### Cost table on Guide (`app/guide/page.module.css:257-298`)
Border `1px solid --border-subtle`, header bg `--bg-card-alt`, header padding `--space-3 --space-4`, header text `--font-body --text-xs --font-semibold` uppercase 0.04em, rows border-bottom `1px solid --border-subtle`, row text `--text-secondary`.

---

## 5. Button styles

See section 2 "Buttons" for typography. Per-variant geometry:

| Variant | bg | color | border | radius | size states |
|---|---|---|---|---|---|
| `primary` | `--accent-primary` | `#000` | none | `--radius-md` | sm 32px / md 40px / lg 48px min-height |
| `secondary` | transparent | `--text-primary` | `1px solid --border-subtle` | `--radius-md` | same |
| `danger` | `--accent-error` | `#000` | none | `--radius-md` | same |
| `ghost` | transparent | `--text-secondary` | none | `--radius-md` | same |

Hover states for primitive variants:
- `Button.module.css` does **not** define hover for `.primary`, `.secondary`, `.danger`, or `.ghost` — only the global `transition: all` on `.button`. Effective hover relies on `:active { transform: scale(0.98); }` and ad-hoc `filter: brightness(1.1)` on consumer overrides.
- Disabled (`:28-30`): `cursor: not-allowed` (no opacity).
- Loading: `.loading { cursor: wait }`; spinner positioned absolute inside the button (`.spinner :80-89`).

### Per-page custom buttons (no primitive)
See full table in §2. Notable shape mismatches:
- Landing page primary uses `--radius-full`, padding `--space-4 --space-8` (`app/page.module.css:150-176`) — pill-shaped. Differs from primitive `--radius-md`.
- Drones list `.segBtn` 4px×10px, 11px font (`app/drones/page.module.css:263-282`) — much smaller than primitive `.sm` (32px min-height).
- Marketplace `.tab`, `.viewTab`, `.typeBtn` use mono font + 10–11px sizes; primitive uses body font.
- Marketplace `.cardBtn` overrides primitive sizing to `min-height: 24px`, `padding: 4px 6px`, `font-size: 9.5px` (`marketplace/page.module.css:843-850`).
- `.packBtnGold` introduces a 5th button colour (gold) with `1px solid --rarity-legendary` border — not in the primitive (`marketplace/page.module.css:1427-1444`).
- `app/drones/[droneId]/page.module.css:576-602` `.buyButton` is a 3px×8px gold-on-black anchor styled like a button but bypasses the primitive entirely; `--radius-sm`, `font-mono 10px --font-semibold`.

---

## 6. Spacing patterns

`.page` containers across the app:

| File:line | gap | padding | other |
|---|---|---|---|
| `app/page.module.css:1-5` (landing) | (none — content uses `.section { padding: 80px var(--space-8); }` + max-width 1280px) | n/a | min-height 100vh |
| `app/dashboard/page.module.css:1-6` | `var(--space-4)` (1rem) | (no padding; wrapped by NavShell `.main` w/ `--space-8` desktop) | min-height calc(100vh - 4rem) |
| `app/drones/page.module.css:1-5` | `var(--space-4)` | (none) | – |
| `app/drones/[droneId]/page.module.css:1-5` | `var(--space-4)` | (none) | – |
| `app/marketplace/page.module.css:1-6` | `var(--space-4)` | `padding-bottom: var(--space-4)` | – |
| `app/leaderboard/page.module.css:1-7` | `var(--space-4)` | `padding-bottom: 56px` (sticky bar room) | – |
| `app/races/page.module.css:1-5` | `var(--space-4)` | (none) | – |
| `app/races/[raceId]/page.module.css:1-5` | `var(--space-4)` | (none) | – |
| `app/tracks/page.module.css:1-5` | `var(--space-4)` | (none) | – |
| `app/tracks/[trackId]/page.module.css:1-5` | `var(--space-4)` | (none) | `--track-neon` custom prop |
| `app/guide/page.module.css:1-4` | (no flex/grid gap) | max-width 1200px | header margin-bottom `--space-8` |
| `app/faq/page.module.css:1-4` | (no gap) | max-width 880px (1440px → 960px line 156) | header margin-bottom `--space-8` |
| `app/login/page.module.css:1-10` | (n/a — `.main`) | `--space-6` | full-screen centered |
| `app/check-email/page.module.css:1-10` | (n/a) | `--space-6` | full-screen centered |
| `app/not-found.module.css:1-8` | (n/a) | `--space-6` | full-screen centered |
| `app/profile/[userId]/page.module.css:1-13` (placeholder) | (n/a) | `--space-8` | full-screen centered |
| `app/admin/page.module.css:1-13` (placeholder) | (n/a) | `--space-8` | full-screen centered |

### App-shell padding
`components/ui/NavShell/NavShell.module.css:255-273`: `.main` has `padding: var(--space-6)` mobile and `padding: var(--space-8)` desktop (≥1024px).

### Inter-section gaps (within `.page`)
- Most authenticated pages — `gap: var(--space-4)` (1rem) between top-level children.
- Guide / FAQ — no flex gap; instead `.categories { gap: var(--space-5); }` (FAQ `:43-47`) and `.content { gap: var(--space-5); }` (Guide `:155-160`). FAQ `.pageHeader { margin-bottom: var(--space-8); }` (line 8-10).
- Landing — `.section { padding: 80px var(--space-8); }` (`page.module.css:193-197`); no gap between sections.
- Tracks list `.grid { gap: var(--space-4); }` (`tracks/page.module.css:7-14`).
- Tracks detail `.statGrid { gap: var(--space-4); }`; `.sectionCard { padding: 0 }` with `.sectionBody { padding: 16px 18px 18px }`.

### Card-grid gaps
- Drones list `.grid` — `var(--space-4)` (`drones/page.module.css:325-329`).
- Marketplace `.grid` — `var(--space-2)` (8px) (`marketplace/page.module.css:434-441`). **Tighter than every other grid in the app.**
- Tracks list `.grid` — `var(--space-4)`.
- Dashboard `.grid` — `var(--space-4)` (`dashboard/page.module.css:15-27`).
- Race detail `.raceLayout` — `var(--space-4)` (`races/[raceId]/page.module.css:244-253`).
- Leaderboard `.podium` — `var(--space-3)` (`leaderboard/page.module.css:283-291`).

---

## 7. Interactive element hover states

(Selector — file:line — effect)

### Buttons / clickable controls (legitimate hovers)
- `.button` primitive: only `:active` scale; no per-variant hover defined (`Button.module.css:24-26`).
- `Button:focus-visible`: outline (`Button.module.css:19-22`).
- `NavShell .link:hover` — `NavShell.module.css:68-71` — text + bg change.
- `NavShell .signIn:hover, .signOut:hover` — `:141-146`.
- `NavShell .menuBtn:hover` — `:176-178`.
- `Card.hover:hover` — `Card.module.css:24-27` — opt-in.
- `Modal .closeBtn:hover` — `Modal.module.css:63-66`.
- `DataTable .sortable:hover` — `DataTable.module.css:56-58`.
- `DataTable .rowInteractive:hover` — `:87-89` (only when `onRowClick` set).
- `StatEditorRow .btn:hover:not(:disabled)` — `:90-95`.
- `Toggle` — no `:hover`.
- Landing `.navLinks a:hover` — `app/page.module.css:59-61`.
- Landing `.navCta:hover` — `:79-82`.
- Landing `.primaryBtn:hover` — `:173-176`.
- Landing `.secondaryBtn:hover` — `:184-187`.
- Landing `.featureCard:hover` — `:350-352` border-color change. **Card is non-clickable** (article only, no link/button) — see below.
- Landing `.footerLinks a:hover` — `:431-433`.
- Landing `.stepArrow` — no hover, just animated icon.
- Dashboard `.navBtn:hover` — `app/dashboard/page.module.css:213-216` (real <button>).
- Dashboard `.feedRow:hover` — `:452-454` (real Link).
- Dashboard `.resultsRow:hover` — `:698-700` (real Link).
- Drones `.topPerformer:hover` — `app/drones/page.module.css:41-44` (real Link).
- Drones `.cardLink:hover .level_*` — `:393-395, 407-409, 421-423, 435-437` (real Link wraps the card).
- Drones `.segBtn:hover` — `:276-278` (real button).
- Drones `.sortSelect:focus` — `:308-311` (focus, not hover).
- Drones detail `.skinSelect:hover` — `app/drones/[droneId]/page.module.css:265-267`. Skin selector is a `<button>` (`page.jsx:474`) — legit.
- Drones detail `.activeHelp:hover` — `:423-425`. The element has `title=` and `cursor: help` but is a `<span>`, not interactive — it's a tooltip trigger, so the hover is informational.
- Drones detail `.ownerLink:hover` — `:572-574` (real Link).
- Drones detail `.buyButton:hover` — `:595-597` (anchor, real link).
- Drones detail `.raceLink:hover` — `:610-612` (real Link).
- Marketplace `.tab:hover` `.viewTab:hover` `.typeBtn:hover` — `:51-53, 125-127, 2358 (no explicit hover but inherits)` (all real buttons).
- Marketplace `.searchInput:focus` — `:163-166` (focus).
- Marketplace `.rangeInput:focus` — `:268-271` (focus).
- Marketplace `.select:focus` — `:403-406` (focus).
- Marketplace `.clearBtn:hover` — `:422-424` (real button).
- Marketplace `.listingCard:hover` — `:468-470` border colour change. **The listingCard wraps in a `<Link>` only when item is a drone** (`app/marketplace/page.jsx:723-732`). For skin listings the card is wrapped in `<div className={styles.cardWrap}>` — a non-clickable wrapper (`marketplace/page.jsx:734-738`). **Hover-on-non-clickable for skin listings.** ⚠
- Marketplace `.cardLink` — has no `:hover` rule, only `border-radius`.
- Marketplace `.sellerLink:hover` — `:835-837`. Span with `role="link" tabIndex=0 onClick={goToSeller}` (`page.jsx:1448-1460`). Real interactive — legit.
- Marketplace `.pageNum:hover` `.pageNext:hover:not(:disabled)` — `:2030-2033, 2064-2067` (buttons).
- Marketplace `.tapeRow:hover` — `:2194-2196`. **Each `.tapeRow` is a `<li>` with NO link or onClick** (`marketplace/page.jsx:1068-1090`). ⚠ **Hover-on-non-clickable.**
- Marketplace `.packBtnGold:hover:not(:disabled)` — `:1435-1438` (real button).
- Marketplace `.packDetailsToggle:hover` — `:1225-1227` (real button).
- Marketplace `.headerLink:hover` — n/a here, that selector is in FAQ.
- Marketplace pack reveal: hover patterns animation-only.
- Marketplace `.pack_gold` and `.possibleCard_*` — only animation/border, no hover state.
- Leaderboard `.tab:hover, .bracketTab:hover` — `app/leaderboard/page.module.css:212-214, 256-258` (real buttons).
- Leaderboard `.podiumCardLink:hover` — `:311-313` translateY (link wrapper).
- Leaderboard `.myRow:hover` — `:534-536` (real <tr> with onRowClick).
- Leaderboard `.pageNum:hover, .pageNext:hover` — `:706-709, 740-743` (buttons).
- Races list `.pageNum:hover, .pageNext:hover` — `app/races/page.module.css:256-259, 290-293`.
- Race detail: only animations on banners; no plain hover rules besides primitive surfaces.
- Tracks list `.card` — has **no `:hover` rule**, but `.cardLink` wraps the article (real Link). No hover effect at all on the card surface.
- Tracks detail `.droneLink:hover, .raceLink:hover` — `app/tracks/[trackId]/page.module.css:265-267, 277-279` (real Links).
- Guide `.tocMobileBtn:focus-visible`, `.tocLink:focus-visible` — `app/guide/page.module.css:67-70, 143-146`.
- Faq `.question:hover` — `app/faq/page.module.css:100-102` (real button).
- Faq `.headerLink:hover` — `:37-39` (real anchor).
- Login / not-found / check-email links — `back:hover { filter: brightness(1.2) }` — all real Links.
- Toast `.toast` — has `cursor: pointer; pointer-events: auto` but no explicit hover.
- Global `::-webkit-scrollbar-thumb:hover` — `globals.css:192-194`.
- Race detail `.statusFinal/.statusLive` — no hover.
- `RacingStatusPill` — no hover.

### Hover-on-non-clickable (UX bug candidates)

The following hover effects exist on elements whose JSX is **not** wrapped in Link/button/anchor and has no `onClick`:

| File:line | Selector | What hover does | Why it's a bug |
|---|---|---|---|
| `app/page.module.css:350-352` `.featureCard:hover` | border-color change | Used in `app/page.jsx:188-198` as plain `<article>` with no link/onClick. **Bug.** |
| `app/marketplace/page.module.css:468-470` `.listingCard:hover` | border-color change | Skin listings render the card inside a non-clickable `<div className={styles.cardWrap}>` (`page.jsx:734-738`). **Bug for skin listings only.** Drone listings are wrapped in `<Link>` (`page.jsx:723-732`) — fine. |
| `app/marketplace/page.module.css:2194-2196` `.tapeRow:hover` | bg lightens | `<li className={styles.tapeRow}>` with no Link / onClick (`page.jsx:1068-1090`). **Bug.** |

(`app/drones/[droneId]/page.module.css:423-425` `.activeHelp:hover` is on a `<span title="…">` info icon — debatable; the `cursor: help` already signals it's a tooltip target, so hover-color affordance is intentional, not a bug.)

---

## 8. Border usage — left-only / asymmetric borders

The historical bug pattern (`border-left: ...` without explicit declarations of all four sides) was searched. Results:

| File:line | Selector | Property | Note |
|---|---|---|---|
| `app/guide/page.module.css:137-141` `.tocLink` | `border-left: 2px solid transparent;` | **Intentional** — used as the active-state indicator (`.tocLinkActive` overrides `border-left-color: var(--accent-primary)` at line 148-151). Element has no other borders set; visually only the left edge ever shows. **Not a bug** but worth noting it's an asymmetric-border pattern. |
| `app/dashboard/page.module.css:582-583` `.quickItem` | `border-right: 1px solid var(--border-subtle);` | Used as inter-column divider in a 4-up grid; explicitly removed on `:last-child` and adjusted on mobile (`:790-803`) to `:nth-child(odd)` and `:nth-child(-n+2)` border-bottom. Intentional grid-divider pattern. |
| `app/drones/[droneId]/page.module.css:228-236` `.skinBlock` | `border-top: 1px solid var(--border-default);` | Section-divider line above the skin selector, intentional. |
| `app/drones/[droneId]/page.module.css:390-397` `.actions` | `border-top: 1px solid var(--border-default);` | Section divider. |
| `app/drones/page.module.css:535-541` `.kpiRow` | `border-top: 1px solid rgba(255,255,255,0.04);` | Section divider above KPI strip. |
| `app/marketplace/page.module.css:676-682` `.listingBody` | `border-top: 1px solid rgba(255,255,255,0.06);` | Section divider. |
| `app/marketplace/page.module.css:2179-2188` `.tapeRow` | `border-bottom: 1px solid rgba(255,255,255,0.04);` | Row divider (intentional). |
| `app/marketplace/page.module.css:2303-2309` `.modalRow` | `border-bottom: 1px solid var(--border-subtle);` | Row divider. |
| `app/marketplace/page.module.css:1241-1250` `.packRates li` | `border-bottom` | Row divider. |
| `app/leaderboard/page.module.css:24-30` `.seasonBlock::after` | half-width 50% pseudo-element divider | Custom divider, not technically a border. |
| `app/leaderboard/page.module.css:585-589` `.yourRankDivider` | `width: 1px; height: 14px; background:` | Faux divider via span, not a border. |
| `app/leaderboard/page.module.css:453-461` `.podiumStats` | `border-top: 1px solid rgba(255,255,255,0.08);` | Section divider. |
| `app/dashboard/page.module.css:540-547` `.countdownTagline` | uses pseudo `::before` 40px-wide hairline (top) | Decorative divider — pseudo, not a border on the element itself. |
| `app/drones/page.module.css:116-125` `.fleetLabel::after` | absolute pseudo divider stub | Decorative. |
| `app/dashboard/page.module.css:54-58` `.sectionHeading` | `border-bottom: 1px solid #3F3F3F;` | Header bar divider. |
| `app/drones/[droneId]/page.module.css:319-334` `.sectionHeading` | `border-bottom: 1px solid var(--border-default);` | Header bar divider. |
| `app/races/[raceId]/page.module.css:223-238` `.sectionHeading` | `border-bottom` | Header bar divider. |
| `app/marketplace/page.module.css:2087-2098` `.tapeHeader` | `border-bottom` | Header bar. |
| `app/guide/page.module.css:170-184` `.sectionHeading` | `border-bottom` | Header bar. |
| `app/faq/page.module.css:53-64` `.sectionHeading` | `border-bottom` | Header bar. |
| `app/leaderboard/page.module.css:24-31` `.seasonBlock::after` | (pseudo) | Decorative. |
| `app/page.module.css:23` `.nav` | `border-bottom: 1px solid var(--border-default);` | Standard nav bar divider. |
| `app/page.module.css:299-301` `.statsBar` | `border-top` and `border-bottom` (both sides) | Symmetric — fine. |
| `app/page.module.css:391-400` `.footer` | `border-top` | Footer divider. |
| `components/ui/NavShell/NavShell.module.css:18-21` `.sidebar` | `border-right: 1px solid var(--border-default);` | Sidebar divider. |
| `components/ui/NavShell/NavShell.module.css:82-86` `.sidebarFooter` | `border-top` | Footer divider. |
| `components/ui/NavShell/NavShell.module.css:155-161` `.mobileBar` | `border-bottom` | Mobile-bar divider. |
| `components/ui/NavShell/NavShell.module.css:236-243` `.drawer` | `border-right` | Drawer divider. |
| `components/ui/Modal/Modal.module.css:31-37` `.header` | `border-bottom` | Modal header divider. |
| `components/ui/StatEditorRow/StatEditorRow.module.css:1-9` `.row` | `border-bottom: 1px solid var(--border-subtle);` | Row divider. |
| `components/ui/DataTable/DataTable.module.css:69-77` `.row` | `border-bottom: 1px solid var(--border-default);` | Row divider. |
| `components/ui/DataTable/DataTable.module.css:23` `.th` | `border-bottom: 1px solid var(--border-default);` | Header divider. |
| `app/dashboard/page.module.css:665-682` `.resultsHeader, .resultsRow` | `border-bottom: 1px solid #3F3F3F` | Row dividers. |
| `app/leaderboard/page.module.css:540-557` `.yourRankBar` | `border-top: 1px solid var(--border-default);` | Sticky-bar divider. |

**Conclusion**: no left-only-without-context bugs found in current source. The closest case (`app/guide/page.module.css:137-141` `.tocLink`) is intentional. All other one-sided borders are correctly used as section dividers (header bars, list separators, sidebar/footer dividers).

---

## 9. Inconsistencies (fix candidates)

Each row pairs **two locations using different values for the same conceptual element**.

### Section heading (h2) — three fonts, three sizes

| Location | family | size | bg | letter |
|---|---|---|---|---|
| `app/page.module.css:199-206` (landing) | `--font-heading` | `--text-2xl` | (none) | 0.01em |
| `app/dashboard/page.module.css:49-59` | `--font-body` | `--text-sm` | `#252525` literal | 0.01em |
| `app/drones/[droneId]/page.module.css:319-334` | `--font-body` | `--text-sm` | `--header-bar-bg` token | 0.01em |
| `app/races/[raceId]/page.module.css:223-238` | `--font-body` | `--text-sm` | `--header-bar-bg` token | 0.01em |
| `app/marketplace/page.module.css:2121-2129` `.tapeTitle` | `--font-body` | `--text-sm` | `--header-bar-bg` token | 0.02em |
| `app/guide/page.module.css:170-184` | `--font-body` | `--text-base` | `#252525` literal | 0.02em |
| `app/faq/page.module.css:53-64` | `--font-body` | `--text-base` | `#252525` literal | 0.02em |
| `app/tracks/[trackId]/page.module.css:183-194` `.sectionHead` | **`--font-mono`** | **`10px`** | `--bg-card-alt` | 0.14em |

**Inconsistency**: the same conceptual element (a card section heading bar) uses three font families, three sizes, two letter-spacing values, and the bg colour is sometimes a token (`--header-bar-bg`) and sometimes a literal (`#252525`). Tracks-detail uses a totally different mono treatment.

### Page padding/gap

- All authenticated `.page` containers use `gap: var(--space-4)` consistently.
- BUT marketplace adds `padding-bottom: var(--space-4)` (`marketplace/page.module.css:1-6`), leaderboard adds `padding-bottom: 56px` (`leaderboard/page.module.css:1-7`), guide and faq don't use gap at all (rely on `.content { gap: --space-5 }`). Other pages have neither.

### Card border colour

- Card primitive: `1px solid var(--border-default)` (`Card.module.css:5`).
- Login / check-email / not-found cards: `1px solid var(--border-subtle)` (`login/page.module.css:17`, `check-email/page.module.css:16`, `not-found.module.css:14`). Subtle vs default — same nominal "card" surface uses two different border colors.
- Dashboard cards override Card primitive with literal `#3F3F3F` (`dashboard/page.module.css:91, 398, 491, 567, 625`) — this is the same value as `--border-default` but bypasses the token.

### Card radius

- Card primitive `--radius-lg` (12px).
- Tracks list `.card` — `--radius-lg`. ✓
- Marketplace `.filtersInner`, `.ticker` — `--radius-md` (8px) (`marketplace/page.module.css:212, 893`).
- Marketplace `.packCard` — `--radius-lg`. ✓
- Drones `.fleet`, `.topPerformer` — `--radius-md` (`drones/page.module.css:95, 34`).
- Leaderboard `.podiumCard` — `--radius-md` (`leaderboard/page.module.css:302`).
- Marketplace `.possibleCard` — `--radius-sm` (`marketplace/page.module.css:1707`).

Three different radii (sm/md/lg) on objects all referred to as "cards".

### Page title (h1) sizes

| File | size |
|---|---|
| Landing (`app/page.module.css:131`) | `--text-3xl` |
| Login (`app/login/page.module.css:24`) | `--text-2xl` |
| Check-email (`app/check-email/page.module.css:30`) | `--text-2xl` |
| Not-found (`app/not-found.module.css:30`) | `--text-2xl` |
| Tracks detail (`app/tracks/[trackId]/page.module.css:67`) | `--text-2xl` |
| Guide (`app/guide/page.module.css:13`) | `--text-4xl` |
| FAQ (`app/faq/page.module.css:13`) | `--text-4xl` |

Three different page-title scales: 1.5rem (auth/error/track-detail), 1.875rem (landing), 2.25rem (Guide/FAQ).

### Card title (drone name) sizes

| File:line | size |
|---|---|
| `app/dashboard/page.module.css:175-183` (spotlight) | `--text-xl` |
| `app/drones/page.module.css:477-490` (card) | `--text-base` |
| `app/drones/[droneId]/page.module.css:81-90` (detail) | `--text-base` |
| `app/races/[raceId]/page.module.css:425-438` (race detail) | `--text-xl` |
| `app/leaderboard/page.module.css:427-440` (podium) | `--text-sm` |
| `app/marketplace/page.module.css:691-704` (listing) | `12px` (literal!) |
| `app/marketplace/page.module.css:2233-2244` (tape) | `12px` literal |

Five different sizes for "drone name" across the app, including raw `12px` literals in marketplace.

### Header bar bg colour: literal vs token

`#252525` (literal) used directly:
- `app/dashboard/page.module.css:57, 70` `.sectionHeading`
- `app/dashboard/page.module.css:449` `.feedRow:nth-child(even)` (alt-row stripe)
- `app/guide/page.module.css:182` `.sectionHeading`
- `app/faq/page.module.css:62` `.sectionHeading`

vs. `var(--header-bar-bg)` token (= `#252525`):
- `app/drones/[droneId]/page.module.css:312, 329` `.statHeader, .sectionHeading`
- `app/races/[raceId]/page.module.css:233` `.sectionHeading`
- `app/marketplace/page.module.css:2093` `.tapeHeader`

vs. `--bg-card-alt` (`#1A1A1A`):
- `app/tracks/[trackId]/page.module.css:186` `.sectionHead` and `app/guide/page.module.css:276` `.costHeader`.

The same intent ("subtle slate header bar") expressed with three values across files.

### Border colour: literal vs token

- `#3F3F3F` literal — `app/dashboard/page.module.css:58, 70, 91, 398, 426, 491, 557, 567, 625, 681, 688`; `app/dashboard/.statBarTrack:369`; `components/ui/NavShell/NavShell.module.css:132, 209` (`.signIn/.signOut`, `.mobileSep`).
- `var(--border-default)` (= `#3F3F3F`) — used everywhere else.

Same colour, different ways of writing it.

### Text colour `#F0F0F0` vs `--text-primary` vs `--header-bar-text`

`#F0F0F0` literal:
- `app/dashboard/page.module.css:53` `.sectionHeading`
- `app/guide/page.module.css:177` `.sectionHeading`
- `app/faq/page.module.css:57` `.sectionHeading`
- `components/ui/NavShell/NavShell.module.css:104, 113, 201, 217` `.username, .points, .mobileUsername, .mobilePoints`

vs `var(--header-bar-text)` (also `#F0F0F0`) — `app/drones/[droneId]/page.module.css:325`, `app/races/[raceId]/page.module.css:229`, `app/marketplace/page.module.css:2125`.

vs `--text-primary` (`#FFFFFF`) — most other places.

`#E5E5E5` literal — `app/dashboard/page.module.css:357` `.statRowLabel`, `app/drones/[droneId]/page.module.css:409` `.activeLabel`, `components/ui/StatEditorRow/StatEditorRow.module.css:24` `.name`. **No matching token.**

### Stat-bar track styling

Three near-identical implementations:
- `app/dashboard/page.module.css:365-380` `.statBarTrack` — height 10px, bg `#2A2A2A` literal, border `1px solid #3F3F3F` literal, border-radius `2px`.
- `components/ui/StatEditorRow/StatEditorRow.module.css:31-46` `.meter` — height 10px, bg `#2A2A2A` literal, border `1px solid #3F3F3F` literal, border-radius `2px`.
- `components/ui/StatBar/StatBar.module.css:24-37` `.track` — height 8px, bg `var(--bg-elevated)`, no border, border-radius `--radius-full`.
- `app/marketplace/page.module.css:764-778` `.statBarTrack` — height 3px, bg `#2A2A2A`, no border, border-radius `2px`.
- `app/leaderboard/page.module.css:81-101` `.progressTrack` — height 6px, bg `--bg-elevated`, border `1px solid --border-subtle`, border-radius `--radius-full`.

Five different "stat bar track" patterns. `#2A2A2A` is a colour with **no token** that appears 3+ times.

### Secondary text colour `#A0A0A0`

Used as a literal:
- `components/ui/DataTable/DataTable.module.css:20` `.th` color
- `app/dashboard/page.module.css:679` `.resultsHeader` color

These match `var(--text-secondary)` but bypass the token.

### Drone image filter (drop-shadow) values

- Dashboard spotlight (`dashboard/page.module.css:260`): `drop-shadow(0 10px 12px rgba(3, 218, 198, 0.32))`.
- Drones detail (`drones/[droneId]/page.module.css:137`): same 0 10px 12px / 0.32 teal.
- Drones list card (`drones/page.module.css:520`): `drop-shadow(0 8px 18px rgba(0, 0, 0, 0.5))` (black, much heavier).
- Marketplace listing (`marketplace/page.module.css:668`): `drop-shadow(0 4px 8px rgba(0, 0, 0, 0.5))` (smaller black).
- Race detail drone (`races/[raceId]/page.module.css:408`): `drop-shadow(0 0 12px rgba(3, 218, 198, 0.28))` (teal halo, no offset).
- Leaderboard podium (`leaderboard/page.module.css:418-424`): `drop-shadow(0 6px 10px rgba(0, 0, 0, 0.5))` black.

Same drone image, six different shadow treatments.

### Pagination – three near-identical reimplementations

`.pagination`, `.pageNum`, `.pageNumActive`, `.pageEllipsis`, `.pageNext` all duplicated in:
- `app/marketplace/page.module.css:2007-2072`
- `app/leaderboard/page.module.css:683-747`
- `app/races/page.module.css:234-297`

Same look (32px, mono `--text-sm`, `:hover { background: rgba(255,255,255,0.04) }`, active `rgba(255,255,255,0.06)`), but never extracted into a primitive. Differ only in `padding: var(--space-4) 0 var(--space-2)` (marketplace) vs `padding: var(--space-3) 0` (leaderboard) vs no padding (races, the row holds it). And races `.pageNext:disabled` lacks `opacity: 0.4` (`races/page.module.css:295-297`) where marketplace has it (`marketplace/page.module.css:2069-2072`).

### `legendaryShimmer` keyframes – 5 redundant copies

Defined in:
- `app/dashboard/page.module.css:155-164`
- `app/drones/page.module.css:456-465`
- `app/drones/[droneId]/page.module.css:676-685`
- `app/marketplace/page.module.css:599-608` and again `:1040, :1353, :1581` (uses same name from different rules)
- `app/races/[raceId]/page.module.css:383-392`

Not all identical: dashboard uses border-color from `0.4 → 0.75`, drones list `0.6 → 0.9`, drones detail `0.4 → 0.75`, races detail `0.4 → 0.75`. Marketplace's two definitions differ in box-shadow magnitude.

### Skin rarity tint pattern – four duplicate blocks

`.skinRarity_rare/_epic/_legendary` repeated verbatim in:
- `app/dashboard/page.module.css:138-153`
- `app/drones/page.module.css:439-454`
- `app/drones/[droneId]/page.module.css:660-674`
- `app/races/[raceId]/page.module.css:367-381`

Mostly the same values but slight numeric drift (border-color `0.4` vs `0.6`, box-shadow `12px` vs `14px`). Drones list overrides to `0.6` and `14px`/`18px`; others stay at `0.4`/`12px`/`16px`.

### Level-tier tint pattern – three duplicates

`.level_steel/_orange/_purple/_gold` blocks repeated:
- `app/dashboard/page.module.css:94-136`
- `app/drones/page.module.css:381-437`
- `app/races/[raceId]/page.module.css:305-364`
- (marketplace uses chained class names `.listingCard.card_level_*` — `marketplace/page.module.css:536-578`)

Drones list and race detail include matching `:hover` selectors that increase the border-color alpha; dashboard doesn't (intentional — non-clickable).

### Tab/pill component – at least 4 separate implementations

| File:line | Selector | family/size | active style |
|---|---|---|---|
| Marketplace `app/marketplace/page.module.css:36-58` | `.tab` mono 10px | bg `--bg-elevated` color `--accent-primary` |
| Marketplace `:111-132` | `.viewTab` mono 10px | color `--accent-primary` weight bold |
| Marketplace `:2346-2363` | `.typeBtn` mono 10px | bg `--bg-elevated` color `--accent-primary` |
| Drones `app/drones/page.module.css:263-282` | `.segBtn` body 11px | bg `rgba(3,218,198,0.15)` color `--accent-primary` |
| Leaderboard `app/leaderboard/page.module.css:197-219` | `.tab` mono 10px | bg `--bg-elevated` color `--accent-primary` |
| Leaderboard `:241-263` | `.bracketTab` mono 9px | color `--accent-primary` (text only) |

Three patterns for the same UX: container-pill-segmented (`tab`), text-only-with-bold (`viewTab`/`bracketTab`), pill-with-tinted-bg (`segBtn`).

### Search input

| File:line | bg | border | radius | font | min-h |
|---|---|---|---|---|---|
| `components/ui/FilterBar/FilterBar.module.css:32-45` `.searchInput` | `--bg-input` | `1px solid --border-subtle` | `--radius-sm` | `--font-body --text-xs` | 30px (28px ≤768px) |
| `app/marketplace/page.module.css:150-173` `.searchInput` | `--bg-input` | `1px solid --border-subtle` | `--radius-sm` | `--font-body --text-xs` | 30px |
| `app/drones/page.module.css:297-311` `.sortSelect` | `--bg-input` | `1px solid --border-subtle` | `--radius-sm` | `--font-body 11px` | 22px |

Search input matches `FilterBar`, but sort select is a hand-rolled smaller equivalent (22px vs 30px) — duplicates with worse a11y.

### Empty / placeholder text

- `EmptyState.title` `--text-xl` `--font-semibold` (`EmptyState.module.css:16-22`).
- `dashboard .empty` `--text-sm` `--text-tertiary` (`dashboard/page.module.css:730-735`).
- `DataTable .empty` `--text-sm` `--text-tertiary` (`DataTable.module.css:117-122`).
- `marketplace .tapeEmpty` `--font-mono --text-sm` (`marketplace/page.module.css:2163-2169`).

### Chip / pill height + padding

| File:line | Selector | padding | font-size |
|---|---|---|---|
| `app/drones/page.module.css:357-374` `.activeRibbon` | `3px 8px` | 9px |
| `app/marketplace/page.module.css:477-492` `.ownerChip` | `2px 6px` | 9px |
| `app/marketplace/page.module.css:1635-1645` `.pill` | `3px 9px` | 9px |
| `app/marketplace/page.module.css:716-723` `.rarityTag` | (none) | 8px |
| `app/marketplace/page.module.css:1471-1483` `.featuredPill` | `5px 10px` | 10px |
| `app/marketplace/page.module.css:2198-2212` `.tapeTypePill` | `2px 8px` | 9px |
| `app/races/[raceId]/page.module.css:185-198` `.pointsChip` | `3px 10px` | `--text-xs` |
| `app/races/[raceId]/page.module.css:200-217` `.conditionChip` | `3px 8px` | `--text-xs` |
| `app/races/[raceId]/page.module.css:529-541` `.trackRecordPill` | `2px 8px` | 10px |
| `app/races/[raceId]/page.module.css:490-504` `.upsetPill` | `2px 8px` | 10px |
| `app/leaderboard/page.module.css:147-156` `.rewardThumb` | `width 22px height 22px` | n/a |
| `Badge.module.css:1-14` `.badge` (primitive) | `--space-1 --space-2` | `--text-xs` |

The Badge primitive exists, but no consumer uses it — at least 11 ad-hoc reimplementations of "small uppercase pill".

### `.mono` utility class — duplicated

- `app/dashboard/page.module.css:726-728` `.mono { font-family: var(--font-mono); }`.
- `app/drones/[droneId]/page.module.css:544-546` `.mono { font-family: var(--font-mono); }`.
- `app/leaderboard/page.module.css:522-524` `.mono { font-family: var(--font-mono); }`.
- `app/races/page.module.css:143-147` `.mono` (also adds color + size).
- `app/tracks/[trackId]/page.module.css:269-271` `.mono`.

Five different `.mono` definitions.

### Hover/border alpha pattern variations

- "Hover-glow border" alphas: `0.5/0.9` (drones list); `0.55/0.95` (drones list other tiers); `0.4/0.7` (skinRarity); `0.45/0.85` (silhouette colours). Same pattern, different magnitudes.

### Animation duration usage

- Loading shimmer durations: `1.4s` (`Skeleton.module.css:10`, `DataTable.module.css:139`).
- `legendaryShimmer` uses `4s ease-in-out` everywhere except `marketplace .pack_gold::after` which uses `6s linear` (`marketplace/page.module.css:1040`) and `bigLegendaryCard::before` which uses `4s linear` (`marketplace/page.module.css:1580`). Three different speeds for the same effect family.
- `bannerEnter` 640ms, `revealBurst` 1.1s, `revealPulseEpic` 900ms, `bigCardFloat` 5s — all bespoke values not pulled from `--duration-*`.

### Colour literals not in `:root`

Color values used in `.module.css` files that have **no token**:
- `#2A2A2A` — appears 4+ times (stat bar track bg).
- `#252525` — appears 4+ times (header bar bg, alt row); token exists (`--header-bar-bg`) but isn't always used.
- `#3F3F3F` — appears 10+ times (border default); token exists (`--border-default`).
- `#E5E5E5` — appears 3+ times (slightly off-white text); no token.
- `#F0F0F0` — appears 5+ times (header bar text); token exists (`--header-bar-text`) but isn't always used.
- `#5A5A5A` — appears once (`dashboard/page.module.css:506` paused countdown unit).
- `#FFA726` — appears once (`races/[raceId]/page.module.css:495` upset pill orange).
- `#FFB000` — appears once (`leaderboard/page.module.css:97` progress fill end stop).
- `#D08843` / `#C8C8C8` — appears once each in podium tier text; tokens `--podium-bronze` (`#CD7F32`) and `--podium-silver` (`#C0C0C0`) exist but aren't used.

### `gold/silver/bronze` colour drift

| File:line | gold | silver | bronze |
|---|---|---|---|
| `globals.css:39-41` tokens | `#FFD700` | `#C0C0C0` | `#CD7F32` |
| `app/leaderboard/page.module.css:336, 353, 370` (podiumRankLabel + trophy) | `#FFD700` ✓ | `#C8C8C8` ✗ | `#D08843` ✗ |

Leaderboard hand-picks slightly different gold/silver/bronze hexes rather than reusing `--podium-*` tokens.

### Nav link active treatment differences

- NavShell sidebar active: `color: var(--accent-primary); background: rgba(3,218,198,0.12)` (`NavShell.module.css:74-80`).
- Guide TOC active: `color: var(--accent-primary); border-left-color: var(--accent-primary)` (no bg) (`guide/page.module.css:148-151`).

Two different active-link motifs co-existing.

### Drone-image frame sizes / aspect ratios

| File:line | aspect | max-width / max-height |
|---|---|---|
| `app/dashboard/page.module.css:242-252` `.spotlightImage` | 4/3 | 320px |
| `app/drones/page.module.css:501-510` `.imageFrame` | 16/9 | (full) |
| `app/drones/[droneId]/page.module.css:116-129` `.droneImageFrame` | 4/3 | 320px (240px mobile) |
| `app/races/[raceId]/page.module.css:394-400, 506-508` `.droneImageFrame` | (none, min-height 200px) | (full) |
| `app/leaderboard/page.module.css:406-416` `.podiumImageFrame` | 16/9 | max-height 110px |
| `app/marketplace/page.module.css:652-660` `.listingImage` | 16/10 | (full) |
| `app/tracks/page.module.css:46-56` `.imageFrame` (track) | 2/1 | (full) |
| `app/tracks/[trackId]/page.module.css:9-22` `.hero` | 3/1 (mobile 2/1) | (full) |

Five different aspect ratios for the same drone image, three different sizes.

### Nav (logo) mark size

- NavShell sidebar logo (`NavShell.module.css:23-36`): font-size `--text-xl`, padding `0 var(--space-6)`.
- NavShell mobile logo (`:180-187`): `--text-lg`.
- Landing logo (`page.module.css:26-36`): `--text-lg`.
- Landing footer logo (`:402-412`): `--text-base`.

Four sizes for the brand mark.

### Form input styles

- Login `.input` (`login/page.module.css:61-75`): `--font-body --text-base`, padding `--space-4`, border `1px solid --border-subtle`, radius `--radius-md`.
- Marketplace `.searchInput` (`marketplace/page.module.css:150-173`): `--font-body --text-xs`, padding `5px 10px 5px 28px`, border `1px solid --border-subtle`, radius `--radius-sm`, min-height 30px.
- Marketplace `.rangeInput` (`:243-258`): `--font-mono 10px`, padding `3px 7px`, min-height 22px, radius `--radius-sm`.
- Marketplace `.select` (`:391-401`): `--font-body 11px`, padding `3px 7px`, min-height 22px.
- FilterBar inputs (`FilterBar/FilterBar.module.css:32-45`): `--font-body --text-xs`, padding `5px 10px`, min-height 30px.
- Drones `.sortSelect` (`drones/page.module.css:297-311`): `--font-body 11px`, padding `3px 7px`, min-height 22px (matches marketplace, conflicts with FilterBar).

Three different input heights (22px, 30px, ~48px) and three font sizes (10px, 11px, `--text-xs`/14px, `--text-base`).

---

End of audit. All locations cite absolute paths (rooted at `/home/aabaad/dev/dronemanager-v2/`). No source files were modified.
