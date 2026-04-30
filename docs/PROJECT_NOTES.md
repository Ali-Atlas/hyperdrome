# PROJECT_NOTES.md

Long-running notes that don't belong in HANDOFF (per-session work log) or
ATLAS (project context). This is the parking lot for ideas, deferred
features, and follow-ups that aren't scoped for the current sprint.

---

## TODO / Post-Demo

### Marketplace live ticker

Replace the marketplace ticker bar with real server-driven activity.

- **Total packs opened counter.** Add a server-side counter (new key in
  `admin_config` or a dedicated counts table). Increment on every
  successful pack open AND every successful capsule open in
  `app/api/marketplace/packs/open/route.js` and
  `app/api/marketplace/capsules/open/route.js`. The marketplace ticker
  reads + displays the real count.
- **Last 5 legendary pulls.** Persist the last 5 legendary skin / mod
  pulls (user's display name + legendary item name + pulled-at
  timestamp). Schema option: a small `recent_legendary_pulls` table
  capped to 5 rows via insert-and-trim, OR a single JSON column on
  admin_config. Whichever is simpler.
- **Cycling display.** Ticker shows one pull at a time, cycles
  automatically through the 5 entries (most recent first).
- **Click-to-expand legendary card.** Clicking a legendary name in the
  ticker opens a modal that renders the legendary card full-size with
  the gold background + rotating-shimmer treatment used in
  `marketplace/page.module.css` (`.skinRarity_legendary`) and the same
  drone-bob animation if equipped on a tier-4. Same look as the
  marketplace + drone-card legendary treatment elsewhere; reuse the
  existing CSS rather than forking a new variant.
- Most recent pull renders first; cycle order is newest → oldest.

### Pending activate/deactivate system

Today, toggling a drone's `active` flag while it's in a PENDING race
takes effect immediately and (per the audit on 2026-04-30) doesn't
affect the locked matchup but does silently change the player's slot
math mid-window. Replace with a queued change that applies after the
race completes.

- **Schema.** New column on `drones`: `pendingActiveChange` - nullable
  enum `'activate' | 'deactivate' | null`, default `null`.
- **Toggle handler.** When the player toggles a drone that's currently
  in a PENDING race, set `pendingActiveChange` to `'activate'` /
  `'deactivate'` instead of flipping `active` directly. The UI toggle
  renders in a yellow / warning state to show the queued intent.
- **Feedback toast.**
  - Activating a drone in a PENDING race → "Drone will activate next round."
  - Deactivating a drone in a PENDING race → "Drone will deactivate after this round."
- **Cancel.** Tapping the warning-state toggle again clears
  `pendingActiveChange` back to `null` (no-op, no DB change to `active`).
- **Apply on race completion.** In `services/race.service.js` after the
  race-execution phase, query `drones` where `pendingActiveChange IS NOT
  NULL`, flip `active` accordingly, then clear `pendingActiveChange` to
  `null`. Same idempotent-best-effort pattern as the rest of that path
  (Neon HTTP has no transactions).
- **Slot math (front-end gate).** When the player tries to queue
  `'activate'`, compute the *effective* active count:
  ```
  effective = (drones where active AND pendingActiveChange != 'deactivate')
            + (drones where !active AND pendingActiveChange = 'activate')
  ```
  Reject the queue if `effective > activeDroneSlots`. Same cap, just
  applied to the post-race state.
- **Matchmaking unchanged.** `getActiveDronesByBracket` continues to
  filter on `drones.active = true` only - it never reads the pending
  flag. Queued changes only land after the race they're queued behind.

### Real-time race updates via websockets / SSE

Today the dashboard / nav footer / race detail pages all poll on 15-30s
cadences for: next-race countdown, matchup creation, race results,
balance updates. Replace with a push channel so updates land instantly
and the polling traffic disappears.

- **Hosting constraint.** Vercel serverless doesn't support persistent
  websocket connections natively. Options:
  - **Pusher** or **Ably** - hosted realtime, drop-in client SDK, free
    tier covers low-volume. Cleanest path; minimal infra.
  - **Standalone Socket.io server** on Fly.io / Railway / Render - more
    control, more ops surface. Pick this only if Pusher / Ably pricing
    or feature ceiling becomes a problem.
  - **Server-Sent Events** through a separate worker route - works in
    one direction (server → client) which covers all four use cases
    here, but Vercel still kills long-lived requests, so this also
    needs a dedicated long-running host.
- **Server pushes (events to emit).**
  - `race:next` - new `nextRaceAt` timestamp + paused flag, emitted
    after each `runRaceCycle` completes. Replaces the 30s
    `/api/races/next` poll in NavShell + dashboard + races page.
  - `race:matchup` - per-user PENDING-race-created notification
    (drone1, drone2, scheduledAt, track, conditions). Replaces the
    15-30s `/api/races/upcoming` poll on the dashboard.
  - `race:result` - per-user race-completed notification (race row
    with full results). Surfaces a result toast in real time and
    refreshes the relevant card without a follow-up fetch.
  - `user:balance` - emitted on every server-side mutation that
    changes `users.points`. Replaces the current `volts:update`
    CustomEvent + JWT-stale workaround in `NavShell` (see the
    `balanceOverride` state in `components/ui/NavShell/index.jsx`).
- **Channel scoping.** Per-user channels for `race:matchup`,
  `race:result`, `user:balance` (auth-gated). Public channel for
  `race:next` (it's global game state).
- **Migration path.** Keep the polling endpoints alive in parallel as
  fallback while the realtime layer rolls out; flip clients over one
  feature at a time. Once stable, drop the polls.
- **Wins.** Eliminates the polling delay (up to 30s on countdown),
  shaves the per-user request count substantially, makes the result-
  reveal and matchup-reveal feel instant instead of "wait a few seconds
  for the next poll".
