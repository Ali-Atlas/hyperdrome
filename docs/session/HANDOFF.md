# HANDOFF.md

Work log for the current session. Archive to docs/archive/ when exceeding 500 lines.

---

## 2026-04-23 — Tracks index + detail pages + /api/tracks/[trackId] + NavShell "Tracks" link

**Captain ask:** build the Tracks feature end-to-end — a new sidebar link (Map icon, between Races and Leaderboard), a two-column track-card index at `/tracks`, a detail page at `/tracks/[trackId]` with hero banner + TRACK STATS / TOP PERFORMERS / RECENT RACES cards, and a new `GET /api/tracks/[trackId]` endpoint returning track + stats + top-5 win-rate + last-10 races. Use existing design system (Card, DataTable, Badge, level colors, flush header bars). Difficulty rendered as 10 dots colored by tier (1-3 teal, 4-6 purple, 7-10 red). Level bracket badge renders as a min→max tier-color gradient. Each track gets a signature neon accent color (cyan/green/orange/white/purple/yellow/red) keyed by name.

**Files added (5) / modified (3):**
- NEW `app/tracks/page.jsx` + `app/tracks/page.module.css` — server-component index. 2-col desktop grid, 1-col at ≤768px. Each `TrackCard` has a top neon stripe (box-shadow glow in the track's signature color), 2:1 image header (`track.imageUrl`), name in heading font, level-bracket badge (`color-mix` gradient between `var(--level-from)` and `var(--level-to)` tier tokens), difficulty dot row (10 dots, filled based on `difficulty`, colored via `getDifficultyColor`), and a compact specs row (Straights · Turns · Length). The whole card is wrapped in `<Link href="/tracks/[id]">`; hover shifts the border to the track's neon.
- NEW `app/tracks/[trackId]/page.jsx` + `app/tracks/[trackId]/page.module.css` — server component, awaits `params.trackId`, calls the service directly (no fetch round-trip), `notFound()` on miss, else `Promise.all([getTrackStats, getTopPerformersOnTrack, getRecentRacesOnTrack])`. Hero banner is aspect-ratio 3/1 desktop, 2/1 at ≤768px, with a neon-colored top stripe + bottom gradient overlay. Title row: track name (2xl heading) + level-bracket badge + difficulty dots + inline specs row. Three `<Card>` sections with flush `.sectionHead` bars (`var(--bg-card-alt)` bar + `--border-subtle` bottom rule): (1) TRACK STATS → 4-col grid (Total Races / Avg Winning Time / Track Record w/ drone + date sub / Most Common condition), collapses 4→2→1 col at 1024/480px; (2) TOP PERFORMERS → DataTable with rank (neon-colored), drone name (Link to `/drones/[id]`), Badge variant="level", W/L, win-rate — empty-state when no drone has ≥3 races on the track; (3) RECENT RACES → DataTable with Date (Link to `/races/[id]`), Matchup (winner side tinted teal), Winner, Conditions, Points. Used a `<Link>` inside the Date cell instead of DataTable's `onRowClick` since server components can't pass function props to client components.
- NEW `app/api/tracks/[trackId]/route.js` — `withApiHandler({ requireAuth: false })` wrapping a GET that returns `{ track, trackStats, topPerformers, recentRaces }`. Throws `ApiError('Track not found', 404)` on unknown id. Public, matching the existing `GET /api/tracks`.
- MOD `services/track.service.js` — added `getTrackById`, `getTrackStats`, `getTopPerformersOnTrack`, `getRecentRacesOnTrack`. The three stat queries use the raw `sql` tagged template from `@/lib/db` (Neon HTTP) rather than Drizzle — they need aggregate SQL (`LEAST(drone1_time, drone2_time)`, `COUNT(*) FILTER (WHERE ...)`, a `participated` CTE with `UNION ALL` for top-performer win-rate) that's cleaner in raw SQL. Min 3 races on the track to qualify for the leaderboard so a single lucky win doesn't top it.
- MOD `lib/utils.js` — added `TRACK_NEON` name→hex map + `getTrackNeon(name)` helper (falls back to `var(--accent-primary)` on unknown), and `getDifficultyColor(difficulty)` returning `var(--accent-primary|secondary|error)` based on 1-3 / 4-6 / 7-10.
- MOD `components/ui/NavShell/index.jsx` — imported `Map` from lucide-react, inserted `{ href: '/tracks', label: 'Tracks', Icon: Map }` between Races and Leaderboard in `NAV_LINKS`.

**Unchanged:**
- `proxy.js` — `/tracks` left out of the matcher on purpose; mirrors the existing `/api/tracks` `requireAuth: false` so tracks are viewable without sign-in (they're static game content, no per-user data).
- `app/api/tracks/route.js` — `getAllTracks` already did what the index page needs; index page calls it directly (server component).

**Track neon color mapping (name-keyed):**
- Neon Straightaway → cyan `#00F0FF` · The Grid → green `#00FF7A` · Circuit Alpha → orange `#FF8C42` · Skyline Drift → purple `#BB86FC` · Voltage Loop → yellow `#FFD700` · Tempest Run → red `#FF4D5E` · Horizon Express → white `#E8E8E8`.

**Verified:**
- `npm run lint` → 0 errors, 8 `<img>` warnings (6 pre-existing + 2 new for the track image on the index card and the hero banner — consistent with every other drone/skin image in the codebase).
- `npx next build` → compiled cleanly. `/tracks` registered as `○ (Static)`, `/tracks/[trackId]` as `ƒ (Dynamic)`, `/api/tracks/[trackId]` as `ƒ`.
- No browser verification by Mercenary.

**Rule exceptions:** 4-file cap escalated for this feature — 3 modified + 5 new files. Captain's spec covers all of them (new pages + CSS + API + service + nav link + color helpers).

**Gotcha worth flagging:** the seeded `tracks.image_url` paths point to `/tracks/*.png` but the `public/tracks/` directory is empty. Index cards + detail hero will render with a broken `<img>` icon until the images are added. Drop the PNGs (or swap the seed data to `.webp`) and they'll pick up automatically — no code change.

**Captain to spot-check at 1440 / 1024 / 375:**
- Sidebar: "Tracks" sits between "Races" and "Leaderboard" with the Map icon; active state when on `/tracks` or `/tracks/*`.
- Index: 2-col grid of cards (1-col ≤768px), each with a top neon stripe matching its signature color, 2:1 image area, name, level bracket (gradient from min→max tier color), 10 difficulty dots colored by tier, specs row, whole-card click links to detail.
- Detail: 3:1 hero (2:1 mobile) with neon top stripe + gradient overlay, title row below. TRACK STATS card with 4 cells; TOP PERFORMERS table with rank + drone link + level badge + W/L + win-rate (min 3 races to appear); RECENT RACES table with Date clickable to race detail, matchup with winner tinted teal, conditions + points.

---

## 2026-04-23 — HELLO race history + 20 skins + wider listings + packs trim (featured/oddsBar/shape out)

**Captain asks:** (1) seed races so every HELLO drone has a real race history; (2) add 20 more skins + listings so the marketplace skins tab has content; (3) make the drone and skin listing cards wider (thin cards were clipping the "Need +X pts" text), and shrink that button text slightly; (4) packs screen: drop the Featured pill + countdown, drop the horizontal odds-gradient bar, replace the trapezoidal "what you could pull" shape with a drone outline (tier webp per rarity), never fade disabled buy buttons (the gold one was dimmed to 0.55), align the Starter pack's button with the other packs' buttons at the bottom, and make all three buy buttons the same width.

**DB seeds (no repo changes):**
- Races: inline `node --env-file=.env.local` inserted 50 completed races across HELLO's 9 drones. Each drone got 4-7 races. Opponents picked from any non-HELLO drone within ±3 levels. Track eligibility respects `level_min`/`level_max`. Times (~80-120s winner, +0.5-3s loser), ELO change (8-22), time-of-day (day/night), weather (clear/rain/wind/heavy_wind), drone1-vs-drone2 side randomized. Post-insert, every HELLO drone's `total_races`/`wins`/`losses`/`elo_rating` was recomputed from the races table so the drones page shows real W/L + shifted ELO. Summary: HELLO drones now have totals ranging from 4 to 7 races with varied win rates (e.g. HELLO_SCOUT_2 4/2, HELLO_APEX_2 2/5) and ELOs 967-1054. Pre-existing GHOST-HAWK also absorbed its old race history (26 races). Winner probability biased slightly (60/40) toward the higher-level drone.
- Skins: inserted 15 new skins owned by MKT_ORBIT/PULSE/NEXUS (5 name-collisions with the original seed were skipped) and a `marketplace_listings` row for each. Distribution: 8 common (e.g. Matte Black, Factory White, Industrial Gray), 6 rare (Neon Pulse, Synthwave Ridge, Data Stream, Aurora Fade, Cobalt Trace, Crimson Arc), 4 epic (Void Walker, Inferno Core, Ion Storm, Nebula Frost), 2 legendary (Mach Zero, Apex Prime). `image_url` points to the matching tier webp so applying one to a drone doesn't 404. Prices: common 150, rare 650, epic 2200, legendary 7500. Total skins in DB: 71.

**Files changed (2):**
- `app/marketplace/page.jsx` — listing-grid `CARD_MIN` bumped 150 → 220 (matches the CSS fallback change). `LegendaryHero` no longer renders the featured pill + countdown or the `<OddsBar>`; its info column now goes straight from "Legendary Pack" subtitle → description → odds text → possible-pull grid → CTA. `PackCard` also drops its `<OddsBar>`. `PossibleCard` swapped its trapezoidal `<div>` for an `<img>` pointing at the tier webp (`POSSIBLE_TIER_IMG` maps common→tier-1, rare→tier-2, epic→tier-3, legendary→tier-4) so every "what you could pull" slot shows a drone silhouette with a rarity-colored drop-shadow. Dead code removed: `OddsBar` component, `Countdown` component, `SEASON_RESET_TARGET` constant.
- `app/marketplace/page.module.css` — `.grid` `minmax(150px, 1fr)` → `minmax(220px, 1fr)` (applies to both Drones and Skins tabs since they share `.grid`). `.cardBtn` font-size 10 → 9px + letter-spacing 0.04 → 0.03em so the "Need +X pts" label fits. `.packCtaRow` gained `margin-top: auto` so the Starter pack's button sinks to the bottom of the flex-column card and aligns with Premium's button across the side-by-side row. `.packBtn` locked to a fixed `width: 240px` (all three buy buttons identical) plus `opacity: 1` and a matching `:disabled { opacity: 1 }` rule. `.packBtnGold:disabled` opacity 0.55 → 1 (keeps the full gold bg, black text, and 16px gold glow when the player can't afford it). New `.possibleDrone` + `.possibleDrone_{rarity}` rules (85% box, rarity-colored `drop-shadow`, commons slightly muted at 0.85 opacity).

**Unchanged:**
- Live ticker (LIVE_TICKER hardcoded, MKT_ORBIT pulled Mach Zero).
- Big tilted gold "L" card on the legendary hero (the "over the top" animation).
- Premium's "Most Popular" + "Save 30% vs Singles" pills.
- Pack reveal modal, open-pack flow, affordability check.
- Legacy `.oddsBar*`, `.featuredPill*`, `.countdown`, `.possibleShape*` CSS left in place — not referenced by any JSX after this pass but scoped to the module.

**Verified:**
- `npm run lint` → 0 errors, 7 `<img>` warnings (6 pre-existing + 1 new for the possible-card drone silhouette — matches every other drone image in the codebase).
- DB after seeds: 50 new races, 15 new skins + listings, HELLO drones show varied W/L.
- No browser verification by Mercenary.

**Rule exceptions:** 4-file cap respected (2 edited files).

**Captain to spot-check:**
- Marketplace Drones + Skins tabs: cards render ~220px wide (up from 150), "Need +X pts" button text fits cleanly at the new 9px size.
- Packs tab: no more featured pill or countdown on the legendary hero; no horizontal odds-gradient bar on any pack; each "what you could pull" card shows a drone silhouette with rarity-colored glow (tier-1 silhouette on commons → tier-4 on legendaries); all three Open Pack buttons render at identical 240px width and sit at the bottom of their cards; gold Legendary button keeps its full vibrant gold when disabled (no fade).
- My Drones: every HELLO drone now shows a real race count, W/L split, and shifted ELO (not 0/0/0/1000).

---

## 2026-04-23 — Packs rebuild: live ticker, legendary hero with big tilted card, side-by-side premium/starter

**Captain ask:** rebuild the packs tab to match the supplied mockup. Top: a small live-ticker strip (green LIVE dot + packs-opened-today + latest legendary pull). Middle: a full-width "featured" legendary pack with a countdown to season reset, description, horizontal gradient odds bar, rarity-colored odds text, a "What You Could Pull" row of six named cards (3 epic + 3 legendary), a right-aligned gold buy button next to an "Earn points by racing" caption, and a big tilted gold "L" card on the right with shimmer/float animation. Bottom: Premium + Starter packs side-by-side, each with the same odds/possible-pull row, plus Premium's "Most Popular" + "Save 30% vs Singles" pills. Drop the Genesis-Set counter and the "Chase the Dragonlord" title. All fantasy-named legendary/epic skins renamed to drone-themed (Mach Zero, Overdrive, Apex Prime, Inferno Core, Hyperion, etc.). Ticker username must be a real seeded user — went with `MKT_ORBIT`. No backend logic changes.

**Files changed (2):**
- `app/marketplace/page.jsx` — `PACK_DEFS` extended: each pack gained a `possible` array of 6 named `{ name, rarity, mystery }` entries used by the new possible-pull grid; legendary gained a `description` aligned to the mockup; premium gained a `pills` array for the two header tags. Added module-level `LIVE_TICKER` (hardcoded with `MKT_ORBIT` + drone-themed pull "Mach Zero") and `SEASON_RESET_TARGET` (computed once at module load = now + 2d04h21m32s so the countdown ticks but doesn't drift). Rewrote `PacksShowcase` into `[LiveTicker, LegendaryHero, PacksRow(Premium + Starter)]`. New components: `LiveTicker`, `LegendaryHero`, `OddsBar` (horizontal gradient bar, `flex: odds[r]` per rarity segment), `PossibleGroup` + `PossibleCard` (6-card "What You Could Pull" row with trapezoidal skin shape + mystery `?` overlay for wild slots), `Countdown` (setInterval-driven d/hh:mm:ss display). The old `Silhouette` component + `PACK_ORDER` constant are gone; all affordability + open-pack wiring reused verbatim — backend untouched.
- `app/marketplace/page.module.css` — new blocks, ~350 lines: ticker strip (LIVE dot + pulse animation, metric, pull line with rarity coloring); `.packsRow` 2-col grid for Premium/Starter; `.heroGrid` 2-col grid (info left, big card right) with its own collapse breakpoints; `.featuredPill`, `.packSubtitle`, `.heroDescription`, `.heroActions`, `.heroHint`, `.countdown` for the hero copy; `.bigLegendaryCard` 220×310 gold-radial card with `rotateY(-14deg) rotateX(6deg)` perspective tilt, 4s `legendaryShimmer` sweep + 5s `bigCardFloat` translate, 140px "L" glyph + "LEGENDARY" sub-label; `.pillRow` + `.pill_accent` / `.pill_muted` for premium's tag row; `.oddsBar` + `.oddsSeg_{common|rare|epic|legendary}`; `.possibleGroup` + `.possibleLabel` + `.possibleGrid` (6-col → 3-col at 900px and 720px) + `.possibleCard_{rarity}` (rarity-glow border) + `.possibleShape_{rarity}` (trapezoidal clip-path with rarity gradient + drop-shadow) + `.possibleMystery` `?` glyph + `.possibleName` + `.possibleRarity`. Breakpoints: 1100px collapses the hero grid + shrinks the big card (220→180); 900px collapses the packs row + drops possible-grid to 3 cols; 720px keeps the collapse, stacks hero actions, clears hero `min-height`, makes buttons full-width on mobile.

**Unchanged (on purpose):**
- Existing pack-opening flow (`/api/marketplace/packs/open`), reveal modal with staggered card-flip animation, affordability check, and sign-in gate — all reused by the new components.
- Gold button treatment (`.packBtnGold` solid gold, black text, 16px glow, `:disabled` opacity 0.55) from the last pass.
- Legacy `.silhouette*`, `.packMain`, `.packInfo`, `.packContents`, `.packCardCompact`, `.packDetailsToggle`, `.packRates` CSS rules left in place (harmless — no longer referenced by the rebuilt JSX but still scoped to the module).

**Name swaps (fantasy → drone/tech):**
- Legendary pack: Chimera → `Mach Zero`, Phoenix Reborn → `Overdrive`, Dragonlord → `Apex Prime`; epics `Thunder Strike` / `Celestial Guard` / `Tidal Surge` kept (already on-brief).
- Premium pack: Inferno Phoenix → `Inferno Core`, Phoenix R... (legendary mystery) → `Hyperion`. Rares `Neon Pulse` / `Synthwave` / `Data Stream` kept.
- Starter pack: `Carbon Fiber`, `Chrome Plate`, `Neon Pulse`, `Prism`, `Hologram`, mystery `Thunder Strike`.

**Verified:**
- `npm run lint` → 0 errors, 6 `<img>` warnings (all pre-existing — no new ones from this pass).
- No browser verification by Mercenary.

**Rule exceptions:** 4-file cap respected (2 files modified). No DB writes this pass.

**Captain to spot-check at 1440 / 1024 / 375:**
- Packs tab top-to-bottom: thin LIVE-strip (pulsing green dot, "2,369 PACKS OPENED TODAY", `MKT_ORBIT pulled Legendary: Mach Zero`), legendary hero (featured pill with live d/hh:mm:ss countdown, "Legendary Pack" sub-label, description, gradient odds bar, rarity-colored odds text, 6 named possible-pull cards with rarity glow, solid-gold Need/Open button right-aligned beside "Earn Points By Racing", big tilted gold "L" card on the right with shimmer + float), Premium + Starter side-by-side (Premium has the two pills above its head; both cards have their own odds bar + possible-pull row + CTA).
- 1100px: hero grid collapses to a single column, big L card moves above the info (via `order: -1`) and shrinks to 180×250.
- 900px: Premium + Starter stack; possible-pull grid drops to 3 columns.
- 720px: hero actions stack; buttons go full-width; ticker + hero padding tighten.

---

## 2026-04-23 — Packs wide layout + gold CTA + drone figure; drones cleanup; HELLO seed

**Captain asks:** packs tab was wasting width (960px cap); legendary pack needs its over-the-top feel back — add a drone figure, make the Need button actually gold and standing out; all pack Need buttons are oversized; drones page: Top Performer container should be content-width (not stretched to fleet height), more space between fleet stats and distribution, remove the top-performer badge on drone cards (bad placement), remove the full-width separator line inside the drone card; seed 8 extra drones for the HELLO user, 3 active, spread across all 4 tiers.

**DB seed (no repo changes):**
- Inline `node --env-file=.env.local` via `@neondatabase/serverless` inserted 8 drones for user `HELLO` (`ef8d4a7a-3418-42d4-82d1-ce98ea66248d`): 2 per tier (Lv 3/5, 7/9, 12/14, 17/19). 3 actives (Lv 5, 9, 17 — one per tier from tiers 1/2/4). Stats built via the same TSB + per-stat-cap formulas used by `lib/db/seed-more-drones.js` with deterministic per-drone jitter so they don't look identical. Pre-existing `GHOST-HAWK` starter drone deactivated so HELLO ends at exactly 3 active; all 4 tiers are still represented across the 9-drone garage.

**Files changed (4):**
- `app/drones/page.jsx` — dropped `isTopPerformer` prop from `DroneCard` and removed the top-badge span. No other logic changed.
- `app/drones/page.module.css` — `.fleetRow { align-items: flex-start }` so the compact Top Performer card no longer stretches to match the taller fleet container. `.topPerformer` padding tightened to `10px 14px`, gap 6 → 4. `.fleetContent` gap 10 → 18px for clear breathing room between the stats row and the distribution stream. `.cardHead` padding-top reverted 32 → 12 (the badge zone is gone). `.cardBody` `border-top` removed (that was the full-width separator Captain flagged). `.topBadge` rule deleted entirely.
- `app/marketplace/page.jsx` — `PackCard` now conditionally renders a `.packDrone` figure (tier-4.webp + `aria-hidden`) as the third grid child on the legendary card. Silhouettes + info column unchanged.
- `app/marketplace/page.module.css` — `.packsShowcase` max-width 960 → 1400 (uses more of the page width on wide screens, stays sensible on mid screens). `.packCardHero .packMain` grid switched to 3 columns `minmax(0, 1fr) auto auto` so info / silhouettes / drone figure sit side-by-side. `.packCtaRow` justifies flex-end, `.packBtn` shrunk from `width: 100%` to `min-width: 220px` — buttons are now right-aligned pills, not full-card bars. `.packBtnGold` rewritten as a SOLID gold button (`background: var(--rarity-legendary); color: #000`) with a 16px gold glow + `:disabled { opacity: 0.55 }`, matching Premium's "solid accent + black text" treatment so it stands out even when the player can't afford it. New `.packDrone` rule (170×170, `drop-shadow` gold glow, `droneFloat` 4.5s ease-in-out infinite). Breakpoints: new 1100px rule hides the drone figure + drops the hero back to 2 columns; 720px collapses to single-column and makes the button full-width for mobile tap size, clears `min-height` on the hero so it doesn't dominate the small viewport.

**Verified:**
- `npm run lint` → 0 errors, 7 `<img>` warnings (6 pre-existing + 1 new for the legendary `.packDrone img` — consistent with every other drone/skin image in the codebase).
- DB summary after seed: HELLO has 9 drones, 3 active, all 4 tiers covered.
- No browser verification by Mercenary.

**Rule exceptions:** 4-file cap respected (3 edits + 1 JSX addition). DB seed happened inline, no new file created.

**Captain to spot-check at 1440 / 1024 / 375:**
- Packs tab: showcase spans more of the page width (up to 1400px). Legendary hero shows info on the left, three card silhouettes in the middle, a floating gold-haloed tier-4 drone on the right. Need button sits right-aligned, solid gold, black text, clearly stands out vs. Premium's solid teal and Starter's outline secondary.
- Below 1100px: drone figure hides, hero falls back to info + silhouettes. Below 720px: single column + full-width button.
- My Drones: Top Performer card sits to the left, sized to content (not stretched tall to match the fleet container). Fleet stats row and the tier-distribution track have noticeable vertical breathing room between them. Drone cards no longer have the "TOP" pill; no full-width separator line inside the card body.

---

## 2026-04-23 — Drones index: top performer, fleet layout, radar drone cards

**Captain ask:** fleet table values smaller; Top Performer as its own entity to the left of the fleet container + a badge on that drone's card; distribution row shows level ranges with color swatches (not color names), straight-cornered, no container border/background, folded into the fleet row; drone cards lose the teal glow behind the image, stack level below name (fixes active-pill collision), use a slightly smaller image, and replace the 3 stat bars with the `<StatRadar>` radial covering all 9 stats.

**Files changed (2):**
- `app/drones/page.jsx` — new `<TopPerformerCard>` component (teal-accented pedestal with Trophy + "TOP PERFORMER" + name + level chip + ELO, linked). `<FleetOverview>` drops its inline top block and now renders `<TierDistribution>` as its last child. Root layout wraps top-performer + fleet in a `.fleetRow` flex. `TIER_LABELS` flipped from `Steel/Orange/Purple/Gold` → `Lv 1-5/Lv 6-10/Lv 11-15/Lv 16-20`. `<DroneCard>` now takes an `isTopPerformer` prop that renders a `.topBadge` (teal `Trophy + TOP` pill, top-left, mirror of the active ribbon); replaces the three `MiniStat` bars with `<StatRadar axes={STAT_KEYS} ...>` using the same `RADAR_SHORT_LABELS` mapping as the drone detail page. Removed the now-unused `MiniStat` helper.
- `app/drones/page.module.css` — added `.fleetRow` horizontal flex + `.topPerformer` / `.topPerfHeader` / `.topPerfName` / `.topPerfMeta` / `.topPerfLevel` / `.topPerfElo` rules. `.fleet` now takes `flex: 1; min-width: 0` so the fleet container grows beside the top-performer card. `.fleetStatValue` 15 → 13px. Removed `.fleetTop*`, `.miniStat*`, `.statBars`. `.tierDist` stripped of its own background/border/radius + padding (now inherits from the fleet container); `.tierTrack` + `.tierSeg` lost their `border-radius` for the straight-corner look. Card header switched to `flex-direction: column` (name on top, level chip below) — resolves the active-pill overlap. `.imageFrame` dropped the radial teal glow and went from `aspect-ratio: 5/3 + padding: 16px` to `16/9 + 20px`, so the image sits flatter and smaller. New `.topBadge` pill. New `.radar { max-width: 170px; margin: 2px auto 0 }` to constrain the radar on narrow cards (overrides StatRadar's default 220px). Breakpoint cleanup: `.fleetRow` stacks below 1024px; dropped the dead `.fleetTop` override.

**Unchanged (on purpose):**
- Active ribbon stays top-right; when both apply, Top badge sits top-left and Active top-right — no collision.
- Level-tier tinted card backgrounds + skin-rarity border treatments (`.level_*`, `.skinRarity_*`) and the `legendaryShimmer` animation for legendary skins.
- `computeFleetStats` + winRate logic unchanged — Top Performer is still `d.eloRating` max from that helper.

**Verified:** `npm run lint` → 0 errors, 6 pre-existing `<img>` warnings (dashboard / drones[droneId] / drones / leaderboard / marketplace ListingCard / races[raceId]). No browser verification by Mercenary.

**Captain to spot-check at 1440 / 1024 / 375:**
- Fleet row reads `[ Top Performer card ]  [ Fleet stats over a straight-edged tier-distribution track ]`. Distribution track is square-cornered and sits flush inside the fleet container — no inner border/background.
- Top performer card is teal-tinted, linking to the winning drone; hovering brightens the border + adds the teal glow.
- Tier legend entries read "Lv 1-5" etc. with the color swatch.
- Drone cards: level chip sits directly below the name, no overlap with the "Active" ribbon. Top performer's card has a teal "TOP" pill at the top-left.
- Image frame is flatter (16:9) with no teal radial glow. Drone image sits smaller inside the frame.
- Radar replaces the old SPD/TRN/DUR bars. All 9 axes render with their short labels (SPD/TRN/ACC/DUR/NV/BAT/RAIN/WIND/CST).
- Below 1024px: fleet row stacks (top performer above fleet container); drone grid reflows.

---

## 2026-04-23 — Pause racing kill-switch + Packs hero sizing

**Captain asks:** (1) pause racing immediately — resource consumption too high; (2) finish the packs redesign: the page had been stripped too far and the Legendary pack no longer dominates — make it the hero (2-3× taller than the others) while keeping silhouettes modest (~80px tall) and the rest of the packs tab as-is (colored odds text already replaces the old multi-color bars; gold-outline CTA, "What's Inside" expander, card-flip reveal modal, affordability checks all retained). No backend logic changes.

**Racing pause (DB-only, no repo changes):**
- Flipped `admin_config.racing_enabled` from `'true'` → `'false'` via inline `node --env-file=.env.local` + `@neondatabase/serverless`. Confirmed before/after via RETURNING.
- Effect: `app/api/races/run/route.js:42` short-circuits with `{ message: 'Racing is paused', racingEnabled: false }` before `runRaceCycle()` runs. Cron keeps firing but returns immediately. No drones/users/races writes.
- To resume: run the same one-liner with `'true'`.

**Packs showcase (CSS-only, 1 file):**
- `app/marketplace/page.module.css` — four rule edits, all scoped to `.packCardHero`:
  1. `.packCardHero`: `min-height: 360px`, `padding: 48px 40px 36px`, `gap: 28px` — enforces the 2-3× size hierarchy vs Starter (~130px) even with "What's Inside" collapsed.
  2. `.packCardHero .packMain`: `flex: 1; gap: 40px; align-items: center` — content breathes and centers vertically in the taller card; buy button stays pinned to the bottom via the existing flex-column packCard layout.
  3. `.packCardHero .silhouette`: `80×112` → `64×88` — hits the "~80px tall" spec. The hero's dominance now comes from padding + whitespace + gold treatment, not ballooned graphics.
  4. `.packCardHero .silMystery`: `30px` → `22px` — scales the `?` glyph to the smaller silhouette.

**Unchanged (already matched spec):**
- `OddsText` component renders rarity-colored text (e.g. "RARE 10% · EPIC 50% · LEGENDARY 40%") — the old horizontal multi-color bars are not in the current code.
- Silhouette glow variants (`sil_common`/`sil_rare`/`sil_epic`/`sil_legendary`/`sil_rainbow`) + mystery `?` overlay.
- Hero gold shimmer (`.pack_gold::after`, 6s `legendaryShimmer`), Premium subtle purple tint (`.pack_purple`, 0.4 border opacity), Starter neutral (`.pack_gray`).
- CTA variants: Legendary gold-outline (`.packBtnGold`), Premium teal (`variant="primary"`), Starter outline-secondary (`variant="secondary"`).
- Pack reveal modal with staggered card-flip animation + affordability checks on buy buttons.

**Verified:**
- `npm run lint` → 0 errors, 6 pre-existing `<img>` warnings (dashboard / drones / leaderboard / marketplace ListingCard at 1275 / races detail — all unrelated to this change).
- No browser verification performed by Mercenary.

**Captain to spot-check at 1440 / 1024 / 375:**
- Legendary pack visibly dominates the showcase column — ~2-3× the Starter card's height; gold shimmer still animating on the card surface.
- Three card silhouettes per pack render at ~80px tall (Hero), with correct glows: Legendary → purple/gold/mystery; Premium → blue/purple/mystery; Starter → gray/gray/blue-mystery.
- Buy buttons centered, full-width: gold outline (Legendary), teal (Premium), outline secondary (Starter). Affordability text still swaps to "Need +N pts" when short.
- "What's Inside" expander opens correctly on all three cards.
- Pack reveal modal still fires card-flip animation after a successful open.
- At ≤720px breakpoint: packMain collapses to single column, silhouettes center.

---

## 2026-04-22 — Logo swap + site-wide flush container headers + quick stats alignment

**Captain ask:** (1) replace 🛸 emoji logo with a top-down drone mark matching nav-link icon style; (2) align the Quick Stats values horizontally across cards on `/dashboard`; (3) make container header bars flush with the container edges (top/left/right) site-wide — screenshot confirmed they were inset on dashboard.

**Root cause of inset headers:** `components/ui/Card/Card.module.css` set a default `padding: var(--space-5)` (20px) on `.card`. Dashboard containers attempted to override with `padding: 0`, but the override wasn't winning — consistent with a Next.js 16 CSS Module ordering quirk. Fix: remove the default from the primitive and let consumers own their padding.

**Files changed (5):**
- `components/ui/NavShell/index.jsx` — replaced emoji in desktop + mobile brand marks with new inline `DroneMark` SVG (body circle + 4 rotor circles + 4 arm lines; 18×18, viewBox 24×24, `stroke="currentColor"`, strokeWidth 2, lucide-style).
- `components/ui/NavShell/NavShell.module.css` — stripped `.logoIcon` `font-size: 1.4em` and teal `drop-shadow`; kept `flex-shrink: 0`.
- `components/ui/Card/Card.module.css` — removed default `padding: var(--space-5)` from `.card`; added `overflow: hidden` so header bars sit cleanly inside the rounded card corners.
- `app/dashboard/page.jsx` — restructured Countdown card to use `<h2 className={styles.sectionHeading}>` + `<div className={styles.cardBody}>` pattern matching the other dashboard containers (previously used an inset `.countdownHeading` inside `.cardBody`).
- `app/dashboard/page.module.css` — added `margin-top: auto` on `.quickValue` so all four Quick Stat values anchor to the bottom of their grid cells and stay horizontally aligned across label wraps; dropped now-redundant `padding: 0` overrides on `.spotlight`, `.liveFeed`, `.countdownCard`, `.quickStatsCard`, `.results` (Card no longer sets padding); dropped their redundant `overflow: hidden` (Card now provides it); removed `.countdownHeading` rule.

**Card consumers audited, no changes required:** `app/leaderboard/page.jsx`, `app/marketplace/page.jsx`, `app/races/[raceId]/page.jsx`, `app/drones/[droneId]/page.jsx`. Every `<Card>` in these files already explicitly sets its own padding (either `padding: 0` for flush-header cards or an explicit padding value for content-only cards), so the primitive change is a no-op for them visually while fixing the ordering issue that blocked flush headers.

**Rule exceptions:** exceeded the 4-file cap (5 files) after Captain approved the site-wide scope.

**Verified:**
- `npm run lint` → 0 errors, 5 pre-existing `<img>` warnings unrelated to this change.
- No `npm run dev` browser verification performed by Mercenary — Captain to visually verify at 1440 / 1024 / 375.

**Captain to spot-check:**
- Nav logo renders as a small drone mark (same visual weight as LayoutDashboard / Trophy / Store icons) in desktop sidebar + mobile drawer.
- Dashboard container header bars extend full width — no visible card-interior gutter between card border and header bar top/left/right.
- Quick Stats values sit on the same horizontal line across all four cards at every breakpoint, including when a label wraps to two lines.
- No regressions on `/leaderboard`, `/marketplace`, `/races/[raceId]`, `/drones/[droneId]` — content padding should look identical to before.

---

## 2026-04-22 — Drone Management page pass (steps 1–9 toward mockup)

**Captain ask:** iteratively move `/drones/[droneId]` (owner management view) toward the supplied mockup while staying consistent with dashboard conventions (flush header bars, design tokens, CSS Modules, responsive at 1440/1024/375). Page titles stay dropped. Full-width header bars kept. Lucide for weather icons.

**Files changed (2):**
- `app/drones/[droneId]/page.jsx` — restructured `DroneManagementView` return block.
- `app/drones/[droneId]/page.module.css` — substantial rewrite of the management view styles; public profile section untouched.

**Step-by-step outcomes:**

1. **Drone card layout flip** — left panel is now a vertical stack: `droneImageFrame` (teal-tinted radial background + soft border + larger inset drone image with deeper drop-shadow) → name → meta line → stat strip → skin block pinned at bottom via `margin-top: auto`. The old side-by-side image/meta layout (plus the 601–1100px mid-range grid override) was removed.

2. **Drone meta row + stat strip** — single mono-cased "Lv X | Owner: Y" meta line (pipe separator per mockup, was `·`). Replaced `.kpiLine` with `.statStrip` / `.statStripItem`: "Total Races / Win Rate / ELO" shown as label-value rows with mono labels in secondary grey and bold primary values.

3. **Skin selector row polish** — single "Skin Equipped" mono label on top, then a button row containing a teal-gradient `.skinSwatch` square + skin name (uppercase) + `ChevronDown`. Dropped the old `.skinHeader` / `.skinSelected` glow elements.

4. **Stat editor row preview + active outline** — already present in `components/ui/StatEditorRow` (`base → current` delta + `rowEdited` teal-tinted background/border when `hasDelta`). No-op.

5. **Stat editor footer** — reversed button order to SAVE (primary) → RESET (secondary) per mockup. Softened `.activeNote`: body font, no uppercase/tracking, `var(--text-secondary)` color. Sub-label text changed to "Actively (eligible for racing)" / "Inactive". Actions row now sits flush against the stat list via a top border instead of the previous floating rounded block.

6. **Performance Summary relocation + chip redesign** — renamed to "Performance Summary" and moved into a new `.rightStack` flex column inside the main 2-col grid, sitting directly below the Stat Editor card. Grid collapses to single column below 1024px along with the rest of `.main`. Chip classes (`chip-optimal` / `chip-moderate` / `chip-poor`) kept — they already use tinted backgrounds with lucide condition icons.

7. **Race History row polish** — DataTable primitive already handles row styling with `.win` / `.loss` / `.mono`. Cleaned up dead `padding: 0` / `overflow: hidden` overrides on `.historyCard` (Card primitive now provides them).

8. **Page title** — kept dropped (Captain's decision). Removed dead `.title` and `.back` rules plus their mobile override.

9. **Responsive sweep** — `.main` breakpoint moved to 1024px (was 1100px) to match the project-wide 1440/1024/375 rule. New 769–1024px media query tightens the drone image aspect ratio; mobile media query collapses actions to stacked + full-width buttons, reduces image/stat-list padding, and wraps `.statHeader` if available-points text overflows. Dropped dead `.kpiLine` and `.title` mobile rules.

**Verified:** `npm run lint` passes (0 errors; the 5 `<img>` warnings are pre-existing).

**Not verified by Mercenary:** UI at 1440 / 1024 / 375 in the browser. Captain to spot-check:
- Left panel vertical stack: image frame big and teal-glowing, name directly below, "Lv N | Owner: X" meta, three-row stat strip, skin selector at bottom.
- Right column stacks Stat Editor → Performance Summary, both with flush #252525 header bars.
- SAVE (primary teal) appears to the left of RESET (secondary grey). Sub-label under Set Active reads "Actively (eligible for racing)" when active.
- Performance Summary chips use Optimal/Moderate/Poor tones with lucide weather icons.
- Race History table renders with WIN (teal) / LOSS (red) results.
- At ≤1024px, left panel + right stack collapse to single column, maintaining all spacing. At ≤768px, action buttons stack full-width, drone image aspect goes to 4:3.
- Public drone profile (non-owner view) unchanged.
