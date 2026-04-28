# Project Notes

Free-form notes that don't belong in `ATLAS.md` (permanent project context),
`PRINCIPLES.md` (quality bar), `HANDOFF.md` (session log), or
`DECISIONS.md` (decision log). Use this for follow-ups and known-but-deferred
issues that should not be lost.

---

## Post-Demo Fixes

- **Same-owner top bracket starvation.** If a player owns the #1 and #2 ELO drones in a bracket, the matchmaker can leave #1 idle for a cycle (no eligible cross-owner partner). Bot backfill catches it on the next cycle, but the gap is visible. Consider relaxing the cross-owner-only constraint when no other pairing exists in the bracket.
- **Skin drop reservoir monitoring.** When the winner's roll lands on a rarity whose vault is fully owned, `rollSkinDropForWinner` returns `null` silently — the player gets nothing and never knows a roll fired. Surface a "No skins available" toast/event, or compensate with volts. Add admin-side monitoring for per-rarity vault depletion so the team sees the reservoir running dry before players do.
