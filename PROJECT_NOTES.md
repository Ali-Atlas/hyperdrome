# Project Notes

Free-form notes that don't belong in `ATLAS.md` (permanent project context),
`PRINCIPLES.md` (quality bar), `HANDOFF.md` (session log), or
`DECISIONS.md` (decision log). Use this for follow-ups and known-but-deferred
issues that should not be lost.

---

## Post-Demo Fixes

- **Same-owner top bracket starvation.** If a player owns the #1 and #2 ELO drones in a bracket, the matchmaker can leave #1 idle for a cycle (no eligible cross-owner partner). Bot backfill catches it on the next cycle, but the gap is visible. Consider relaxing the cross-owner-only constraint when no other pairing exists in the bracket.
- **Skin drop reservoir monitoring.** When the winner's roll lands on a rarity whose vault is fully owned, `rollSkinDropForWinner` returns `null` silently — the player gets nothing and never knows a roll fired. Surface a "No skins available" toast/event, or compensate with volts. Add admin-side monitoring for per-rarity vault depletion so the team sees the reservoir running dry before players do.

## Pre-Launch Security

- Strip detailed segment scores from race API response. Currently `races.raceLog` ships per-segment `drone1Score`, `drone2Score`, segment type, and weather multipliers to the browser. A motivated player could reverse-engineer stat weight formulas from this data. Fix: only send cumulative time gap per segment (enough for the gap-over-race chart). Keep full segment data in the DB for internal analytics. Do NOT expose individual scores, stat weights, or multiplier values.

- Race log sanitization endpoint: create a helper that transforms the raw raceLog into a client-safe version before sending in API responses. Apply it in the race detail and race list endpoints.

## UI Surface Gaps

- **Drone XP not visible anywhere.** `drones.xp` and `drones.xpToNextLevel` are written on every race (`services/race.service.js`) and drive `checkAndLevelUp`, but no component renders them. Add an XP meter and "XP to next level" readout on the drone management page (`app/drones/[droneId]/page.jsx`), under or beside the level badge. Want both the raw numbers (e.g. "240 / 600 XP") and a thin progress bar. Lower-priority follow: consider mirroring on the dashboard spotlight drone and the public profile drone tiles.
