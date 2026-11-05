# Runbooks

Operating steps for Hyperdrome on NEAR testnet. Behavior and interfaces are in [SPEC.md](../../SPEC.md); these files hold the commands.

| Runbook                        | Use it to                                                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [dev-setup.md](dev-setup.md)   | Install the toolchain, run the gates, fill in the environment, create a test database, build, test and deploy the contract, and find and export the keys                                |
| [deploy.md](deploy.md)         | Seed a new environment (`npm run seed:world`), run the smoke test before a deploy, read `GET /api/health`, schedule the 3-minute tick, pause racing, recover a batch that cannot settle |
| [seed-teams.md](seed-teams.md) | Create the four AI teams (`npm run seed:teams`), resume a stopped run, bring teams up to a changed roster, and check them on chain                                                      |

## Where a task is

| Task                                                | Place                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| First local run                                     | dev-setup.md, "Install" then "First run against a new Neon database" |
| Run the tests without Neon                          | dev-setup.md, "Test database"                                        |
| Build, test or redeploy the contract                | dev-setup.md, "Contract"                                             |
| Top up the owner or the contract account            | dev-setup.md, "Top up"                                               |
| Change the settlement key's method list             | dev-setup.md, "Rotate the settlement key's method list"              |
| Put the ops and settlement keys in the app's env    | dev-setup.md, "Export a key for the app's env"                       |
| Seed tracks, bots and the catalog; switch racing on | deploy.md, "World seed"                                              |
| Check a build end to end                            | deploy.md, "Before a deploy: the smoke test"                         |
| Set up the scheduler, or send one tick by hand      | deploy.md, "Scheduler"                                               |
| Pause racing                                        | deploy.md, "Pausing"                                                 |
| A batch fails to settle, or drones stay locked      | deploy.md, "When a batch cannot settle"                              |
| Seed or repair the AI teams                         | seed-teams.md                                                        |

## Not written

- Key rotation has no runbook of its own (`docs/runbooks/key-rotation.md` does not exist). What exists: the settlement key procedure in dev-setup.md, and the play key rotation as code, `rotatePlayKey` in [lib/near/adapter.js](../../lib/near/adapter.js), which the team seed calls and [tests/near/adapter-keys.test.js](../../tests/near/adapter-keys.test.js) covers. There is no procedure for replacing `KEY_ENCRYPTION_KEY` or `ADMIN_KEY_ENCRYPTION_KEY`.
- The Vercel project setup and the rollback step are not in deploy.md (BUILD_PLAN.md T15 owns them).
