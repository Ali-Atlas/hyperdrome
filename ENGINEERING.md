# ENGINEERING.md

Engineering standards for Hyperdrome on NEAR: process, code quality, testing, security, reliability, style and copy. One standards file; AGENTS.md holds the working rules for coding agents and SPEC.md holds the design.

Scope rule (the ratchet): these standards apply in full to every file created or changed after the `pre-hackathon` tag. Untouched baseline files are grandfathered. Touching a baseline file brings it under the standards for the parts you touch; it does not oblige a rewrite of the rest. Never refactor baseline code that the task does not need.

---

## 1. Process

- SPEC.md is the source of truth for behavior, data, interfaces and constants. BUILD_PLAN.md is the source of truth for sequence and scope. A design change updates SPEC.md in the same pull request as the code.
- One task, one branch (`task/<id>-<slug>`), one PR, one acceptance list written before the work starts. A PR merges only when its acceptance list is met and CI is green.
- `main` is never pushed to directly and must always build, pass CI and deploy.
- Every decision that changes architecture, security posture or scope is logged in DECISIONS.md with date and reason. Every task run is logged in HANDOFF.md: what changed, what was verified, what is open.
- External values (library versions, chain parameters, RPC URLs, contract addresses, API shapes) are verified against official documentation before they are committed, and the source is cited in the PR description.

## 2. Code quality

### JavaScript (app)

- Plain JS with JSDoc on every exported function and component prop. Type checking is on: `tsconfig.typecheck.json` sets `checkJs: true` and `strict: true` for the directories listed in its `include`; `tsc --noEmit` runs in CI. New directories are added to `include` when created. Baseline directories join `include` only when a task touches them and the errors are fixed.
- ESLint (`eslint-config-next` plus `eslint:recommended`, rules as errors) and Prettier, enforced by the pre-commit hook and CI. No warnings merged.
- No file over 400 lines after the change. A baseline file over 400 lines that a task touches is split along feature boundaries as part of that task.
- Services own database access; route handlers and server components call services only. The race engine (`lib/game-engine`) stays pure: no I/O, no `Math.random` (seeded PRNG injected), no `Date.now`.
- Chain access goes through one adapter module (`lib/near`). Nothing else imports `near-api-js`.
- No dead code, no commented-out code, no `console.log`. `console.error` for failures only, structured as `{ scope, msg, ...fields }`.
- Dependencies: adding one requires a line in the PR description saying why and what was considered. Pinned exact versions.

### Rust (contract)

- `rustfmt` and `clippy` with `-D warnings` in CI. `overflow-checks = true` in every profile.
- No `unwrap`, `expect` or `panic!` on contract paths; use `require!` and `env::panic_str` with a message that names the rule violated.
- Every public method has a doc comment stating who may call it, what it changes, what it emits and how it fails.
- State is versioned from the first deploy (`enum VersionedState { V1(..) }` and per-record enums). `migrate()` exists from the first deploy.
- Each method that can be called with a function-call key is explicitly listed in SPEC.md under the key's method list; nothing else is callable that way.

## 3. Testing

Tests go where a bug costs money, is invisible, or cannot be fixed after the fact. CI runs all of them on every PR; a red check blocks merge.

### Required

- Contract (near-sandbox): every public method's success path; every failure path that guards money, ownership, settlement or idempotency (unauthorized caller, wrong owner, over cap, cap exceeded, insufficient Volts, bound item moved alone, listed, locked, bad seq, settled twice, state drift). Exact event asserted for mints, burns, transfers and settlement. Settlement gas asserted under the SPEC 13 budget. Upgrade test: deploy V1, write state, deploy V2, migrate.
- Engine: determinism (1,000 identical runs); golden replays in `tests/golden/`, updated in the same PR with the reason; the property bounds that exist.
- Adapter (`lib/near`): key encryption round trip and tamper cases; seq and unknown-outcome resolution; event and error parsing from fixtures. One integration run on testnet per adapter change, recorded in HANDOFF.md.
- Scheduler: cannot double-fire a tick; cannot settle a batch twice; a failed phase leaves the batch retryable.
- Zod schemas for every mutation body, unit-tested.
- One end-to-end smoke script on testnet (create account, allocate, equip, enter a batch, settle, verify on-chain state and the explorer link), run before every deploy and recorded in HANDOFF.md.

### Not required

Route tests per mutation, service tests against a test database, exact events for cosmetic state changes, failure paths for cosmetic rules, tests of lint rules or mocks, simulated outages. Add one only when a reviewer asks, with the reason in the PR.

### Definition of done for a PR

1. Acceptance list met, each item checked by a test or a named manual step.
2. Lint, format, type check, unit and contract tests green locally and in CI.
3. SPEC.md updated if behavior, data or constants changed.
4. HANDOFF.md entry written.
5. No secrets, no debug output, no TODOs without an issue reference.
6. Reviewer pass (fresh context) against SPEC.md and this file, findings resolved.

## 4. Security

### Threat model (kept in SPEC.md, summarized here)

Assets: player items and Volts, the treasury, the settlement authority, player keys, the contract's upgrade authority. Actors: a malicious player, a leaked player key, a compromised server, a dishonest operator, a block producer. Trust boundaries: browser to server, server to chain, server to AI-team accounts, contract owner to contract.

### Keys and custody

- Least privilege everywhere. Player keys: function-call only, scoped to the game contract and the listed methods, zero deposit. Settlement key: `commit_batch` and `settle_batch` only. AI-team keys: scoped like player keys, with on-chain spend caps. Full-access keys: deploys and account administration only, never loaded by application code, with one named exception: `lib/near` `rotatePlayKey` opens a player's admin key for a single DeleteKey + AddKey transaction that replaces that player's play key (DECISIONS.md 2.22).
- Player secret keys are encrypted at rest with AES-256-GCM under `KEY_ENCRYPTION_KEY`; admin keys under a separate `ADMIN_KEY_ENCRYPTION_KEY`. Both are Vercel encrypted env vars. Rotation runbook in `docs/runbooks/key-rotation.md`: one transaction deletes the old key and adds the new one; rotation is tested in CI against the sandbox.
- Every environment (local, preview, production) has its own NEAR accounts, database, Pusher app and secrets. Nothing is shared with the MegaETH deployment or the live hyperdrome.vercel.app database.

### Contract checklist (reviewed before every deploy)

- Access control on every state-changing method (`predecessor_account_id` checked against the owner, the settlement key account or the token owner as the method requires).
- Arithmetic is checked; balances use `u128`; no silent truncation.
- Storage growth is bounded per call and paid for (NEP-145 or measure-and-refund); no unbounded user-controlled collections.
- Commit-reveal: the hash is verified, the reveal is bound to the batch or pack id, a reveal cannot be replayed, and the chain seed is mixed in.
- Idempotency: every player action carries an `action_id`; duplicates are rejected before any state change.
- Bound items cannot move alone; a drone transfer moves all bound items atomically and emits one event per token.
- Upgrade path tested; `migrate()` is `#[private]` and `#[init(ignore_state)]`.
- Independent review: before the demo build, a separate reviewer session with fresh context reads the contract against this checklist and SPEC.md. Findings are logged in DECISIONS.md.

### App checklist

- Zod validation on every mutation body at the route boundary. Authorization (session plus ownership) on every protected route. No trust in client-supplied ids beyond lookup.
- Rate limiting backed by the database or Upstash so it holds across serverless instances; tighter limits on account creation.
- `Origin` check on all non-GET routes. Security headers (HSTS, nosniff, frame-deny, referrer policy, permissions policy) in `next.config`.
- Public endpoints never return another player's balances or keys.
- `gitleaks` and `npm audit --audit-level=high` in CI; Dependabot enabled; `cargo audit` for the contract.
- Before the repo goes public: a full-history secret scan, then GitHub secret scanning and push protection switched on.

## 5. Reliability and performance

- The race scheduler cannot double-fire: a database advisory lock or a `batches` row with a unique `(cadence_slot)` guards each tick. A tick that finds the lock held exits.
- Every chain write is idempotent and retried with backoff; the `action_id` or `batch_id` makes the retry safe.
- RPC: `FailoverRpcProvider` with FastNear primary and Lava secondary, 10 s timeout per call.
- Gas budgets per method live in SPEC.md; settlement gas is asserted in tests, other budgets are measured on testnet and recorded in HANDOFF.md. Settlement batches attach 200 TGas and cap at the batch size the measured gas allows.
- Structured logs with a request id; `GET /api/health` reports database, RPC, Pusher and scheduler lag.
- Landing page budget: first contentful paint under 2 s on a mid-range phone; the hero video streams after first paint; total JS under 300 KB gzipped on the landing route.
- The hosted demo stays up through 2026-11-25; the deploy runbook in `docs/runbooks/deploy.md` includes the rollback step.

## 6. What is grandfathered and what is not

| Area               | Baseline files                           | New or touched files   |
| ------------------ | ---------------------------------------- | ---------------------- |
| Type checking      | Off until touched                        | On, strict             |
| File length        | Allowed over 400                         | Under 400              |
| Tests              | None required                            | Required per section 3 |
| Lint and format    | Format on touch only                     | Full                   |
| Security checklist | Reviewed once at the public-release scan | Reviewed per PR        |

## 7. Style, accessibility, content and copy

- Server components by default; `'use client'` only when state, effects or browser APIs demand it. Normalize DB-backed data by id. `next/image` with explicit dimensions. Respect Next.js 16 caching defaults; read `node_modules/next/dist/docs/` before using `revalidate`, `cache` or `'use cache'`.
- CSS Modules co-located with the component. Every color, spacing, font, radius, shadow and breakpoint comes from a variable in `app/globals.css`; hardcoding is a bug. Build on `components/ui/*` primitives. Responsive at 1440, 1024 and 375.
- Semantic HTML. Keyboard-accessible controls with visible focus. Labeled inputs with linked error messages. `aria-label` on standalone icons, `aria-hidden` on decorative ones. WCAG 2.1 AA contrast on the dark theme. `prefers-reduced-motion` respected.
- Loading, error and empty states on every data view (`Skeleton`, `Toast`, `EmptyState`). Error messages are specific and actionable. Numbers formatted consistently.
- Copy, in the app and in these docs: no em or en dashes, hyphens only. No "X, not Y" contrasts. No editorial closers. Declarative, present tense, short sentences, digits for numbers. Game-mechanic copy matches SPEC.md exactly, with no rounding or paraphrasing of formulas. No border accents on Guide and FAQ section blocks.
