# Deploy

Operating the hosted app. T15 adds the Vercel project setup, health checks and the rollback step; this file starts with the scheduler, which T9 ships.

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
