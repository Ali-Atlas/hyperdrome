# Runbooks

Operating steps for Hyperdrome on NEAR testnet. Behavior and interfaces are in [SPEC.md](../../SPEC.md); these files hold the commands.

| Runbook                            | Use it to                                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [dev-setup.md](dev-setup.md)       | Install the toolchain, run the gates, fill in the environment, create a test database, build, test and deploy the contract, and find and export the keys                               |
| [deploy.md](deploy.md)             | Seed a new environment (`npm run seed:world`), run the smoke test after a deploy, read `GET /api/health`, schedule the 3-minute tick, pause racing, recover a batch that cannot settle |
| [key-rotation.md](key-rotation.md) | See what `rotatePlayKey` does to a play key (only the team seed calls it), replace the settlement key or the ops key, and see what cannot be replaced without re-sealing               |
| [seed-teams.md](seed-teams.md)     | Create the four AI teams (`npm run seed:teams`), resume a stopped run, bring teams up to a changed roster, and check them on chain                                                     |

## Where a task is

| Task                                                | Place                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| First local run                                     | dev-setup.md, "Install" then "First run against a new Neon database" |
| Run the tests without Neon                          | dev-setup.md, "Test database"                                        |
| Build, test or redeploy the contract                | dev-setup.md, "Contract"                                             |
| Top up the owner or the contract account            | dev-setup.md, "Top up"                                               |
| Change the settlement key's method list             | dev-setup.md, "Rotate the settlement key's method list"              |
| Replace the settlement key or the ops key           | key-rotation.md, "Settlement key and ops key"                        |
| Put the ops and settlement keys in the app's env    | dev-setup.md, "Export a key for the app's env"                       |
| Seed tracks, bots and the catalog; switch racing on | deploy.md, "World seed"                                              |
| Check a build end to end                            | deploy.md, "The smoke test"                                          |
| Set up the scheduler, or send one tick by hand      | deploy.md, "Scheduler"                                               |
| Pause racing                                        | deploy.md, "Pausing"                                                 |
| A batch fails to settle, or drones stay locked      | deploy.md, "When a batch cannot settle"                              |
| Seed or repair the AI teams                         | seed-teams.md                                                        |

## Not written

- Rotating one player's play key has no script or command; `rotatePlayKey` exists and only the team seed calls it (key-rotation.md, "Play key of a player or team").
- Replacing `KEY_ENCRYPTION_KEY` or `ADMIN_KEY_ENCRYPTION_KEY` has no procedure: nothing re-seals what they sealed (key-rotation.md, "What cannot be rotated without re-sealing"). Rotating the full-access keys of the two root accounts has none either.
