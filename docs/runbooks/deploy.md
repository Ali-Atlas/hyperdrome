# Deploy

Operating the hosted app: the Vercel project, the world seed, the smoke test, the health route, the scheduler and rollback.

## Hosted deployment

Production is the Vercel project `hyperdrome-near` (team `collide-scopes-projects`), connected to `Ali-Atlas/hyperdrome`, at https://hyperdrome-near.vercel.app. Every merge to `main` deploys production.

- Region: `vercel.json` sets `regions: ["iad1"]` (AWS us-east-1), the region of the Neon `prod` branch.
- Previews are off: `git.deploymentEnabled` in `vercel.json` is `{ "**": false, "main": true }`. A branch that matches both rules deploys when one of them is `true`, so only `main` builds. A branch cut before this setting reached `main` still creates a preview until it merges `main`; with no Preview variables that build fails.
- Database: the Neon branch `prod`, created from `dev` on 2026-11-08 with its data. Run `db:migrate` against it before a merge that adds a migration: nothing runs migrations on deploy.

### Only the hosted scheduler ticks

`dev` and `prod` share the contract `game.hyperdrome.testnet` and its keys, and a batch id is a slot on that contract. Nothing ticks Neon dev: no `npm run smoke`, `scripts/tick.mjs` or `/api/races/run` against a server backed by dev. A tick there would commit a batch for a slot production also uses and lock drones production does not know about.

### Environment variables

Every variable is set on Production only. Preview and Development hold none. Changing one takes effect at the next deployment.

| Name                                                                                                                            | Type   | Local source                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET`                                                                                    | Secret | `.env.prod.local`                                                                                                    |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `NEAR_OPS_KEY`, `NEAR_SETTLEMENT_KEY`, `KEY_ENCRYPTION_KEY`, `ADMIN_KEY_ENCRYPTION_KEY` | Secret | `.env.local`                                                                                                         |
| `NEAR_NETWORK`, `NEAR_OWNER_ID`, `NEAR_GAME_ID`, `NEXT_PUBLIC_EXPLORER_URL`                                                     | Config | `.env.local`                                                                                                         |
| `ADMIN_EMAILS`                                                                                                                  | Secret | set directly on Vercel (the Google email allowed on the admin page)                                                  |
| `DEMO_ACCOUNT_CAP`                                                                                                              | Config | set directly on Vercel: 300 since 2026-11-09 (T23; the code default is 100), sized by the sign-up cost in SPEC.md 15 |
| `NEXT_PUBLIC_SITE_URL`                                                                                                          | Config | set directly on Vercel: `https://hyperdrome-near.vercel.app` since 2026-11-10 (T25); read at build time              |

Unset on purpose: `NEAR_RPC_URL` and `NEAR_RPC_FAILOVER_URL` (the SPEC.md 15 defaults apply), `NEAR_RPC_API_KEY`, the Pusher names, `NEAR_ADAPTER`, `NEAR_TESTNET_INTEGRATION`, `SMOKE_BASE_URL`.

Moving the site to another domain (for example `hyperdrome.com`): add the domain to the Vercel project, set `NEXT_PUBLIC_SITE_URL` to it on Production, and redeploy; the value is inlined at build time, so nothing changes until the rebuild. `metadataBase`, `og:url`, `og:image`, the sitemap, robots and token metadata follow it ([lib/site-url.js](../../lib/site-url.js)). Outside the app: add `https://<domain>/api/auth/callback/google` to the Google OAuth client's redirect URIs before the switch; Auth.js takes its URLs from the request host (`trustHost: true` in `lib/auth/index.js`). The Origin check and the NEP-413 wallet challenge use the host each request came to, so they need nothing. The contract's `nft_metadata.base_uri` is null today; if it is ever set (`set_base_uri`, SPEC.md 4.4), it is on chain and has to be set again.

Set a value over stdin, so it reaches neither the shell history nor the process list:

```sh
vercel env add <NAME> --environment production --sensitive   # value on stdin; --no-sensitive for Config
```

`.env.local` in the main checkout is the one local source for every session. `.env.prod.local` sits beside it; load it explicitly with `node --env-file`. Next.js auto-loads a file named `.env.production.local` in any local build or start, which would point a local session at the production database, and it never auto-loads `.env.prod.local`.

## World seed

A new environment (a database and the contract it points at) is seeded once, after `npm run db:migrate`:

```sh
npm run seed:world                  # tracks, Season 1, racing_enabled (created false), 20 bots, catalog cache
npm run seed:world -- --racing-on   # the same, and racing_enabled = true
```

To seed production, load both env files, `.env.prod.local` second so its `DATABASE_URL` wins: `node --env-file=.env.local --env-file=.env.prod.local --import ./scripts/register-alias.mjs scripts/seed-world.mjs`. Run it after `set_skin_caps` so the catalog cache holds the live caps.

The script reads `.env.local` and prints one line per step with what it created, updated and skipped, then the explorer link of every bot it minted. Every step checks before it acts: a second run prints `Nothing to do: every step skipped.`, and a run that stopped part way resumes. Bots earn XP and level up: when one has left its bracket (weeks of racing), a later run mints its replacement, so run the seed again if a bracket runs short of bots. The seed needs the real adapter (`NEAR_ADAPTER` unset). Bots are minted with the ops key to the game account, so keep other users of the ops key (a second seed, a command-line owner call) off while it runs. If it stops with "outcome is unknown", wait a minute before running it again: it counts the bots on chain first, and a transaction that has not landed yet would be minted a second time (one spare bot, harmless).

## The smoke test

`scripts/smoke-testnet.mjs` plays one new demo account through the whole loop on testnet and fails loudly if any link is broken (SPEC.md 13). Run it against production after a merge, with racing on. `.env.prod.local` comes second so its `CRON_SECRET` wins (with several `--env-file` flags, a later file overrides an earlier one):

```sh
SMOKE_BASE_URL=https://hyperdrome-near.vercel.app node --env-file=.env.local --env-file=.env.prod.local \
  --import ./scripts/register-alias.mjs scripts/smoke-testnet.mjs
```

`npm run smoke` on its own targets http://localhost:3000; use it only against a server on its own database and contract (see "Only the hosted scheduler ticks"). The script needs `CRON_SECRET` for the target and the chain adapter's variables (it reads the drone's ELO from the contract). It ticks, waits for the next 3-minute slot and ticks again; the four recorded runs took 1 min 39 s, 3 min 32 s (HANDOFF.md, T13), 2 min 43 s (T11 part 2) and 1 min 38 s (T9b), and a run beside another scheduler waits up to 3 slots for the matchup and 3 for the settlement. Exit 0 prints the report (player, drone, race, ELO before and after, the settle transaction link, the health line); exit 1 names the assertion that failed. Record the report in HANDOFF.md. Each run leaves one demo account with its drone inactive, counted against `DEMO_ACCOUNT_CAP` and the 5 per IP per hour limit. It works with a scheduler running on the target: a slot the scheduler already ticked is read instead.

The second tick of a run commits the next batch. With a scheduler running, the next tick settles it. On an environment nobody ticks, settle it by hand so no drone stays locked: set `racing_enabled` to `false`, send one tick in the next slot (`node --env-file=.env.prod.local scripts/tick.mjs <url>`; variables already set win over the `.env.local` the script loads), then set it back.

## Health

`GET /api/health` is public. It answers 200 with `ok: true` when the database answers (the migrations applied), the RPC answers a `get_constants` view, each within 8 s, and the scheduler is ok; a healthy answer is cached for 60 s. It answers 503 otherwise, never cached, with the failed check `false`. `scheduler.ok` is false when racing is on and `lastTickAgeSeconds` is over 300 (or no tick has run) or `oldestCommittedAgeSeconds` is over 600. A stale tick means the cron-job.org job has stopped or the deployment is failing; a stuck batch means ticks run and settlement does not, so read the function logs (`scope: 'scheduler'`) and "When a batch cannot settle". While racing is paused those two conditions pass. `scheduler.funding` shows what pays for chain work, and `scheduler.ok` is also false, racing on or off, when the settlement key's allowance is under 2.1 NEAR, the ops key's under 1 NEAR, the game account's balance above its storage stake under 3.7 NEAR, or any AI team's balance or play-key allowance under 0.55 NEAR. Those floors are two days of measured burn (SPEC.md 8). To raise an allowance, re-add the key ([key-rotation.md](key-rotation.md)); to fund an account, see [dev-setup.md](dev-setup.md), "Top up". `racingEnabled` is the kill switch below.

## Scheduler

The race loop is one HTTP route, `POST /api/races/run` (GET works too), guarded by `CRON_SECRET` and run every 3 minutes (SPEC.md 2.3, 6). Each call is one tick: it claims the slot `floor(unix_seconds / 180)` in `cron_ticks` (a second call in the same slot answers `claimed: false` and does nothing), settles the batches of earlier slots, commits this slot's batch, then lets each AI team take at most one action (SPEC.md 10; no team starts later than 40 s into the tick, and the answer lists each team's outcome under `teams`). A tick that fails leaves its batch in a state the next tick resumes from, so a missed or doubled call is safe. `vercel.json` ships with `crons: []`: Vercel cron on the Hobby plan runs at most once a day, so the hosted scheduler is the cron-job.org job below.

### The cron-job.org job

| Setting       | Value                                                              |
| ------------- | ------------------------------------------------------------------ |
| URL           | `https://hyperdrome-near.vercel.app/api/races/run?mode=background` |
| Method        | POST                                                               |
| Header        | `x-cron-secret: <CRON_SECRET>` (the value in `.env.prod.local`)    |
| Schedule      | every minute                                                       |
| Timeout       | the default, 30 s                                                  |
| Notifications | on failure, and when the job is disabled automatically             |

`?mode=background` claims the slot, answers 202 and runs the phases in `after()`, inside the route's 60 s `maxDuration`. cron-job.org closes a request at 30 s and counts it as failed, disables a job after more than 25 failures in a row, and a full tick has taken 38.3 s (HANDOFF.md, T12). The first call of a slot claims it; the other two answer 200 with `claimed: false`, so a lost call costs one minute at most.

A background tick's phases run after the answer, so a phase that fails does not fail the request. Watch `scheduler.lastTickAgeSeconds` in `GET /api/health` and the function logs (`scope: 'scheduler'`). The next tick resumes the batch.

### The health monitor job

A second cron-job.org job watches the route that reports a stopped scheduler or a stuck batch:

| Setting       | Value                                                  |
| ------------- | ------------------------------------------------------ |
| URL           | `https://hyperdrome-near.vercel.app/api/health`        |
| Method        | GET                                                    |
| Header        | none                                                   |
| Schedule      | every 5 minutes                                        |
| Timeout       | the default, 30 s                                      |
| Notifications | on failure, and when the job is disabled automatically |

With racing on, the route answers 503 until the tick job has run, so create the tick job first.

### By hand

`scripts/tick.mjs` sends one synchronous tick. It reads the secret from the environment, then `.env.local`:

```sh
node --env-file=.env.prod.local scripts/tick.mjs https://hyperdrome-near.vercel.app
```

With no URL it targets a local server on http://localhost:3000; the rule in "Only the hosted scheduler ticks" applies.

The second call within the same 3-minute slot answers `claimed: false`.

### Pausing

`admin_config.racing_enabled` is the kill switch. When it is not `true`, a tick still settles the batches already committed (so no drone stays locked) and commits nothing; `GET /api/races/next` answers `paused: true`.

### When a batch cannot settle

A batch whose `settle_batch` fails three times (`batches.attempts`) is aborted by the tick with `abort_batch`: the batch and its races are marked `failed`, the drones unlock, nothing is paid. The reason is in the function logs (`scope: 'scheduler'`). A commit that never reached the chain is resolved by the next tick through `get_batch` (the batch is failed). If that commit lands after all, the settle phase aborts it on the next tick: every failed batch of the last 24 hours with no settle or abort transaction is re-read, and one found on chain under the same seed hash is aborted (log `late commit aborted`, the hash in `batches.settle_txs`). If drones still stay locked under a failed batch, abort it by hand with the settlement key, then check that `in_batch` is null. The batch id is the slot:

```sh
near contract call-function as-transaction game.hyperdrome.testnet abort_batch \
  json-args '{"batch_id":<slot>}' \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as game.hyperdrome.testnet network-config testnet \
  sign-with-access-key-file ~/.near-credentials/testnet/hyperdrome.testnet-settlement.json send
near contract call-function as-read-only game.hyperdrome.testnet get_drone \
  json-args '{"token":"d:<n>"}' network-config testnet now
```

`abort_batch` panics with `settled` when the batch is settled or already aborted.

## Rollback

Use Vercel Instant Rollback: on the project's overview page, Production Deployment tile, Instant Rollback (the Hobby plan reaches the previous production deployment only). It repoints the domain at once and restores that deployment's build and environment variables.

It does not roll back the database or the contract. Migrations stay applied and chain state stays as it is, so the older build must work against the newer schema.

After a rollback Vercel stops assigning new production deployments to the domain, so merges do not go live. To restore that, promote a deployment: the Manage button on the same tile, or `vercel promote <deployment id or url>`.
