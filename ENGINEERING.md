# ENGINEERING.md

Engineering standards for Hyperdrome on NEAR. PRINCIPLES.md keeps the style, accessibility, content and writing rules; this file covers process, code quality, testing, security and reliability. Both apply to every change. Where they conflict, this file wins.

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
- Plain JS with JSDoc on every exported function and component prop. Type checking is on: `jsconfig.json` sets `checkJs: true` and `strict: true` for the directories listed in its `include`; `tsc --noEmit` runs in CI. New directories are added to `include` when created. Baseline directories join `include` only when a task touches them and the errors are fixed.
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

CI runs all of the following on every PR. A red check blocks merge.

### Contract (near-sandbox)
- Every public method: the success path and every failure path, named after the rule (unauthorized caller, wrong owner, over spend cap, bound item moved alone, batch settled twice, duplicate action id, insufficient Volts, listing not active).
- Gas: each batch-settlement test asserts `gas_burnt` is under the budget set in SPEC.md.
- Events: each state change asserts the exact event emitted.
- Upgrade: a test deploys V1, writes state, deploys V2 and runs `migrate()`.

### Engine
- Determinism: the same seed, drones, track and conditions produce byte-identical results across 1,000 runs.
- Golden replays: a fixed set of recorded races checked into `tests/golden/`; any engine change that alters a result updates the golden file in the same PR with the reason in the description.
- Property tests: scores stay within bounds, segment times stay within `[0.8, 8.0]`, payouts are never negative, mod effects stay within clamp.

### App
- Service tests against a test database (schema pushed fresh per run).
- Route tests for every mutation: auth required, ownership enforced, Zod rejection, idempotent replay returns the first result.
- One end-to-end smoke script against testnet: create account, allocate, equip, enter a batch, settle, verify on-chain state and the explorer link. Run before every deploy and recorded in HANDOFF.md.

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
- Least privilege everywhere. Player keys: function-call only, scoped to the game contract and the listed methods, zero deposit. Settlement key: `commit_batch` and `settle_batch` only. AI-team keys: scoped like player keys, with on-chain spend caps. Full-access keys: deploys and account administration only, never loaded by application code.
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
- Gas budgets per method live in SPEC.md and are asserted in tests; settlement batches attach 200 TGas and cap at the batch size the measured gas allows.
- Structured logs with a request id; `GET /api/health` reports database, RPC, Pusher and scheduler lag.
- Landing page budget: first contentful paint under 2 s on a mid-range phone; the hero video streams after first paint; total JS under 300 KB gzipped on the landing route.
- The hosted demo stays up through 2026-11-25; the deploy runbook in `docs/runbooks/deploy.md` includes the rollback step.

## 6. What is grandfathered and what is not

| Area | Baseline files | New or touched files |
|---|---|---|
| Type checking | Off until touched | On, strict |
| File length | Allowed over 400 | Under 400 |
| Tests | None required | Required per section 3 |
| Lint and format | Format on touch only | Full |
| Security checklist | Reviewed once at the public-release scan | Reviewed per PR |
