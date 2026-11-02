# ATLAS.md - Project Context

<!-- The Team Atlas workflow (roles, modes, testing rule) lives in ~/.claude/CLAUDE.md and applies automatically. This file contains only project-specific context. -->

---

## Project Context

### Application
**Drone Manager v2** — Competitive idle drone racing. Players own drones, allocate stats (speed, turning, acceleration, durability, night vision, battery, rain, wind, consistency), and auto-race against bracketed opponents every ~2 minutes. A weighted simulation decides outcomes; winners earn points + XP, losers earn XP. Points spend on stat upgrades and the marketplace.

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.2.3 (App Router) |
| Runtime | React 19.2.4 |
| Language | Plain JavaScript (.js / .jsx) — **no TypeScript** |
| Styling | CSS Modules + CSS Custom Properties (no Tailwind, no utility libs) |
| State | React Context (`SessionProvider`, `ToastProvider`) + server components |
| Database | Neon Postgres (`@neondatabase/serverless` HTTP driver) |
| ORM | Drizzle ORM (`drizzle-orm`, `drizzle-kit`) |
| Auth | NextAuth v5 (beta) — Resend email magic links, JWT session, Drizzle adapter |
| Email | Resend (`resend` SDK) |
| Validation | Zod v4 |
| Icons | `lucide-react` |
| Deployment | Vercel |

### Architecture
- **App Router**, server components by default. Client components opt in with `'use client'`.
- **Services layer** (`services/*.service.js`) wraps Drizzle queries — API routes and server components call services, never the DB directly from a route handler.
- **Game engine** (`lib/game-engine/`) is pure JS — race simulation, matchmaking, economy. Deterministic inputs, easy to unit test.
- **Validators** (`lib/validators/index.js`) — Zod schemas are the source of truth for input shapes; check constraints live at the app layer, not the DB (keeps the schema file portable for the Neon HTTP driver, which has no transactions).
- **Normalized DB ids** — drones, users, races all keyed by UUID.
- **Container/Presentational split** for feature components under `components/{feature}/`.

### Key File Paths
| What | Where |
|------|-------|
| App entry / root layout | app/layout.jsx |
| Landing page | app/page.jsx |
| Global styles + design tokens | app/globals.css |
| Auth config | lib/auth/index.js |
| Auth route handler | app/api/auth/[...nextauth]/ |
| DB client | lib/db/index.js |
| DB schema (Drizzle) | lib/db/schema.js |
| DB seed | lib/db/seed.js |
| Services | services/*.service.js |
| Game engine | lib/game-engine/{economy,matchmaking,race-simulator}.js |
| Validators (Zod) | lib/validators/index.js |
| API utilities | lib/api/ |
| Session hook | hooks/useSession.js |
| UI primitives | components/ui/ (Badge, Button, Card, CountdownTimer, DataTable, EmptyState, FilterBar, Modal, NavShell, Skeleton, StatBar, StatEditorRow, Toast, Toggle) |
| Feature components | components/{admin,dashboard,drones,leaderboard,marketplace,races}/ |
| Dev proxy | proxy.js |
| Drizzle config | drizzle.config.js |
| Full game spec + task log | DEVELOPMENT_PLAN.md |

### Routes

**Public pages**
| Route | Purpose |
|-------|---------|
| `/` | Landing page |
| `/login` | Email magic-link sign-in |
| `/check-email` | "Check your inbox" verify page |
| `/leaderboard` | Global leaderboard |
| `/marketplace` | Drone / skin marketplace |
| `/races` | Races index |
| `/races/[raceId]` | Single race detail |
| `/drones` | Drones index |
| `/profile/[userId]` | Public user profile |

**Protected pages** (require session)
| Route | Purpose |
|-------|---------|
| `/dashboard` | Player dashboard (countdown, quick stats, feed) |
| `/drones/[droneId]` | Owned drone detail + stat editor |
| `/admin` | Admin console |

**API routes** (`app/api/`)
- `auth/[...nextauth]` — NextAuth handler
- `drones` + `drones/[droneId]`
- `races`, `races/[raceId]`, `races/next`, `races/run`
- `users`, `users/[userId]`
- `leaderboard`, `leaderboard/me`
- `marketplace`, `marketplace/[listingId]`
- `skins`, `skins/apply`, `skins/remove`
- `tracks`
- `admin/config`

### Design System (CSS variables from `app/globals.css`)
- **Theme:** dark, neon accents. Never hardcode color/spacing/font/size values — reference variables.
- **Backgrounds:** `--bg-primary` `#000`, `--bg-secondary` `#0A0A0A`, `--bg-card` `#121212`, `--bg-card-alt` `#1A1A1A`, `--bg-elevated` `#1E1E1E`, `--bg-input` `#1E1E1E`.
- **Accents:** `--accent-primary` `#03DAC6` (teal), `--accent-secondary` `#BB86FC` (purple), `--accent-error` `#CF6679`.
- **Rarity:** common `#9E9E9E`, rare `#03DAC6`, epic `#BB86FC`, legendary `#FFD700`.
- **Fonts:** `--font-heading` Rajdhani, `--font-body` Inter, `--font-mono` JetBrains Mono.
- **Breakpoints:** 1440px (desktop), 1024px (tablet), 375px (mobile) — every component must look right at all three.

### Verification
- **Captain verifies. Mercenary does not run verification commands.** Build the change cleanly to top-engineer standards and stop. Captain runs dev / lint / build / browser checks.
- Available commands (for Captain's reference, not Mercenary's):
  - `npm run dev` — compile + visual check in the browser.
  - `npm run lint` — eslint.
  - `npm run build` — production build.
  - `npm run db:push` — push Drizzle schema changes.
- **Never run tests unless Captain explicitly asks.** The only test command in the repo is `npm run test:economy`, and it's reserved for Captain-driven requests.

---

## Rules That Never Change

1. **This is NOT the Next.js you know.** Next.js 16 has breaking changes from prior versions. Before writing Next.js-specific code (route handlers, caching, `headers()`/`cookies()`, `params`, metadata, middleware, server actions, etc.) read the relevant guide in `node_modules/next/dist/docs/`. Heed deprecation notices. See `AGENTS.md`.
2. **Plain JavaScript only.** No `.ts` / `.tsx` files. Use JSDoc for type hints on functions and component props.
3. **CSS Modules + CSS variables only.** No Tailwind, no utility classes, no inline styles, no styled-components. Every component gets a co-located `.module.css`. All colors/spacing/fonts come from variables in `app/globals.css`.
4. **Reuse shared primitives.** Build from `components/ui/*` (Button, Card, DataTable, Modal, Toast, etc.) — never create one-off styled elements that duplicate an existing primitive.
5. **Responsive at 1440 / 1024 / 375.** Every page and component must hold up at all three breakpoints.
6. **Services own DB access.** API routes and server components call `services/*.service.js`. Drizzle queries do not live in route handlers.
7. **Zod at the boundary.** Every mutation route validates input with the Zod schemas in `lib/validators/` before touching the DB.
8. **Neon HTTP driver has no transactions.** Bootstrap / multi-step writes must be best-effort with logged failure recovery (see `lib/auth/index.js` `createUser` event for the pattern).
9. **Auth via NextAuth JWT session.** Don't read tokens from localStorage. Use `auth()` from `lib/auth/index.js` on the server and `useSession()` from `hooks/useSession.js` on the client.
10. **JSDoc comments** on exported functions and component props — they replace TypeScript for IDE hints.
11. **Captain verifies, not Mercenary.** Build the change to top-engineer-grade clean-code standards, log it in HANDOFF.md, and stop. Do not run dev / lint / build / browser checks to verify completed work — Captain handles all verification.
12. **Max 4 files per change.** If a fix needs more, escalate to Captain before writing code.
