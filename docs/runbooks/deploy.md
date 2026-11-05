# Deploy

Operating the hosted app. T15 adds the Vercel project setup and the rollback step; this file covers the world seed, the smoke test and the health route (T13) and the scheduler (T9).

## World seed

A new environment (a database and the contract it points at) is seeded once, after `npm run db:migrate`:

```sh
npm run seed:world                  # tracks, racing_enabled (created false), 20 bots, catalog cache
npm run seed:world -- --racing-on   # the same, and racing_enabled = true
```

The script reads `.env.local` and prints one line per step with what it created, updated and skipped, then the explorer link of every bot it minted. Every step checks before it acts: a second run prints `Nothing to do: every step skipped.`, and a run that stopped part way resumes. Bots are minted with the ops key to the game account, so keep other users of the ops key (a second seed, a command-line owner call) off while it runs. If it stops with "outcome is unknown", wait a minute before running it again: it counts the bots on chain first, and a transaction that has not landed yet would be minted a second time (one spare bot, harmless).

## Before a deploy: the smoke test

`scripts/smoke-testnet.mjs` plays one new demo account through the whole loop on testnet and fails loudly if any link is broken (SPEC.md 13). Run it against the build that is about to go out, with racing on:

```sh
npm run smoke                                   # a local server on http://localhost:3000
SMOKE_BASE_URL=https://<app> npm run smoke      # a preview or the production deployment
```

It needs `CRON_SECRET` for the target and the chain adapter's variables in `.env.local` (it reads the drone's ELO from the contract). It takes 4 to 10 minutes: it ticks, waits for the next 3-minute slot and ticks again. Exit 0 prints the report (player, drone, race, ELO before and after, the settle transaction link, the health line); exit 1 names the assertion that failed. Record the report in HANDOFF.md. Each run leaves one demo account, counted against `DEMO_ACCOUNT_CAP` and the 5 per IP per hour limit.

The second tick of a run commits the next batch. With a scheduler running, the next tick settles it. On an environment nobody ticks, settle it by hand so no drone stays locked: set `racing_enabled` to `false`, send one tick in the next slot (`node scripts/tick.mjs <url>`), then set it back.

## Health

`GET /api/health` is public and cached for 60 s. It answers 200 with `ok: true` when the database answers and the RPC answers a `get_constants` view, and 503 otherwise with the failed check `false`. `scheduler.lastTickAgeSeconds` is the time since the last tick started: over 360 with racing on means the scheduler has missed a slot. `racingEnabled` is the kill switch below.

## Scheduler

The race loop is one HTTP route, `POST /api/races/run` (GET works too), guarded by `CRON_SECRET` and run every 3 minutes (SPEC.md 2.3, 6). Each call is one tick: it claims the slot `floor(unix_seconds / 180)` in `cron_ticks` (a second call in the same slot answers `claimed: false` and does nothing), settles the batches of earlier slots, then commits this slot's batch. A tick that fails leaves its batch in a state the next tick resumes from, so a missed or doubled call is safe. `vercel.json` ships with `crons: []`; pick one of the two schedulers below.

### Option A: Vercel cron (Pro plan)

Vercel cron on the Hobby plan runs at most once a day, so a 3-minute schedule needs Pro. Set `vercel.json` to:

```json
{ "crons": [{ "path": "/api/races/run", "schedule": "*/3 * * * *" }] }
```

Vercel calls the path with `Authorization: Bearer <CRON_SECRET>` when the `CRON_SECRET` env var is set on the project (Vercel docs, "Securing cron jobs"). The route accepts that header or `x-cron-secret`.

### Option B: an external scheduler

Any scheduler that can send an HTTP request every 3 minutes works, for example cron-job.org or a `crontab` entry on a machine that stays up:

```
*/3 * * * * curl -s -X POST -H "x-cron-secret: $CRON_SECRET" https://<app>/api/races/run
```

Set the header to the project's `CRON_SECRET`. Two schedulers may run at once: the slot claim makes the second call a no-op.

### By hand

`scripts/tick.mjs` sends one tick with the secret from `.env.local`:

```sh
node scripts/tick.mjs                   # local dev server
node scripts/tick.mjs https://<app>     # a deployment
```

The second call within the same 3-minute slot answers `claimed: false`.

### Pausing

`admin_config.racing_enabled` is the kill switch. When it is not `true`, a tick still settles the batches already committed (so no drone stays locked) and commits nothing; `GET /api/races/next` answers `paused: true`.

### When a batch cannot settle

A batch whose `settle_batch` fails three times (`batches.attempts`) is aborted by the tick with `abort_batch`: the batch and its races are marked `failed`, the drones unlock, nothing is paid. The reason is in the function logs (`scope: 'scheduler'`). A commit that never reached the chain is resolved by the next tick through `get_batch` (the batch is failed). If that commit lands after all, the settle phase aborts it on the next tick: every failed batch of the last 24 hours with no settle or abort transaction is re-read, and one found on chain under the same seed hash is aborted (log `late commit aborted`, the hash in `batches.settle_txs`). If drones still stay locked under a failed batch, abort it by hand with the settlement key (docs/runbooks/dev-setup.md, settlement key) and check `get_drone` shows `in_batch: null`.
