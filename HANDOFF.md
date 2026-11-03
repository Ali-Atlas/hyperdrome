# HANDOFF.md

One entry per task run, newest first. Each entry: date, task id, what changed (files), what was verified (commands and results), what is open. The MegaETH-era log is in docs/archive/HANDOFF-megaeth.md.

## 2026-11-02 T0 Consolidate docs, add standards and agent rules
- Changed: created ENGINEERING.md, DECISIONS.md, HANDOFF.md, LICENSE (MIT, Copyright (c) 2026 Ali Atlas), docs/archive/README.md. Replaced AGENTS.md, README.md. Appended `/tmp/` to .gitignore. Moved with git mv into docs/archive/, content unchanged: ATLAS.md, PRINCIPLES.md, DEVELOPMENT_PLAN.md, DEPLOY_INSTRUCTIONS.md, PROJECT_NOTES.md, STYLING-AUDIT.md, ONCHAIN_ROADMAP.md, SECURITY_MAINNET_CHECKLIST.md, DRONE_CARD_DESIGN.md, INVENTORY_PAGE_PROMPT.md (last four from docs/), docs/PROJECT_NOTES.md as PROJECT_NOTES-docs.md, docs/session/HANDOFF.md as HANDOFF-megaeth.md. Deleted docs/session/DECISIONS.md (empty table) and the empty docs/session directory. CLAUDE.md unchanged. The branch also carries a revert of the superseded first T0 draft (f77a986), so the net diff against main is only the files above.
- Verified: git status clean apart from the listed files; git diff --stat main matches the task list (21 paths: 5 added, 3 modified, 1 deleted, 12 renamed); `git diff -M --name-status main` shows all 12 moves as R100 (content identical); `git diff main -- CLAUDE.md` empty. Lint, tests and build not run (docs-only task; tooling arrives in T1).
- Open: T1 tooling (CI, pre-commit hook, type check, Prettier, gitleaks). SPEC.md and BUILD_PLAN.md to be added.
