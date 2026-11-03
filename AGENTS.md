# AGENTS.md

Instructions for any coding agent working in this repository. CLAUDE.md points here, so Claude Code and Codex read the same rules.

## Read first, in this order

1. SPEC.md (behavior, data, interfaces, constants; source of truth)
2. BUILD_PLAN.md (the task you are on, with its acceptance list)
3. ENGINEERING.md (standards)
4. DECISIONS.md (why things are the way they are)
5. The HANDOFF.md entry for the previous task

Do not explore the codebase to find configuration or parameters. If SPEC.md does not have it, stop and say so; the fix is to add it to SPEC.md, never to guess. Nothing under `docs/archive/` is current.

## Working rules

- One task per session, from BUILD_PLAN.md, on its own branch `task/<id>-<slug>`. Do not start the next task.
- Write the acceptance list into the PR description before coding.
- Run before finishing: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `cargo test` plus `cargo clippy -- -D warnings` for contract work. A task is not done while any of these fail.
- Match the ratchet in ENGINEERING.md section 6: full standards on new and touched code, no refactoring of baseline code the task does not need.
- Verify every external value (library versions, chain parameters, RPC URLs, contract addresses, API shapes) against current official documentation before committing it. Cite the source in the PR description. Do not trust values from the prompt blindly.
- This is Next.js 16. APIs, conventions and file structure differ from older versions. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js-specific code. Heed deprecation notices.
- Plain JavaScript with JSDoc, CSS Modules with variables from `app/globals.css`, `components/ui/*` primitives, services own DB access. See ENGINEERING.md sections 2 and 7.
- All chain access goes through `lib/near`. Nothing else imports `near-api-js`.
- If a design change is needed, update SPEC.md in the same PR and add a DECISIONS.md line. If the change is large or affects security, stop and ask before implementing.
- Finish by appending a HANDOFF.md entry: date, task id, what changed (files), what was verified (commands and results), what is open.

## Never

- Commit secrets, keys, `.env*` files or database URLs. Keys live in environment variables.
- Push to `main`, force-push, or rewrite history.
- Deploy to mainnet, spend tokens, or sign anything with a full-access key from application code (one exception: `lib/near` `rotatePlayKey`, which opens a player's admin key for a single DeleteKey + AddKey transaction; DECISIONS.md 2.22).
- Edit art assets under `public/`, or baseline game constants, without a SPEC.md change that says so.
- Add a dependency without a line in the PR description saying why.
- Mark a task done with failing checks, skipped tests, or `TODO` without an issue reference.
- Write to GitHub on weekdays (Monday to Friday) between 9:00 and 18:00 America/New_York: no git push, no tag push, no PR create, edit, comment or merge, no gh API writes. Commit locally during those hours; push and merge after 18:00 or on weekends.

## Commits and PRs

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, scoped to the task. Small commits.
- PR title `[T<id>] <summary>`. PR body: acceptance list with check marks, verification commands and output, SPEC.md sections touched, sources for external values.
- Dates in HANDOFF.md and DECISIONS.md are the local date, America/New_York.

## Repository map

- `app/` Next.js routes and pages. `components/` UI. `services/` DB access. `lib/game-engine/` pure simulation. `lib/near/` chain adapter. `contracts/hyperdrome/` Rust contract. `tests/` app and engine tests. `docs/runbooks/` operations. `docs/archive/` superseded MegaETH-era docs. `scripts/` seeds and ops.
- Scratch and temporary files go in `tmp/` (git-ignored), never in the tree.
