# Hyperdrome

Hyperdrome is an idle drone-racing strategy game. Every 3 minutes the active drones are paired by level bracket and ELO and raced 1v1 by a deterministic simulator. A race is committed in one 3-minute slot and settled by the next slot's tick; for the first 2 minutes after the commit the owner can change the equipped mod and skin and allocate stat points, and after that the drone is locked until the race settles. Winners and losers earn Volts and XP; Volts pay for stat points, packs, vendor drones and marketplace purchases ([SPEC.md](SPEC.md) section 1). One NEAR contract, `game.hyperdrome.testnet`, holds the drones, skins and mods (NEP-171), the Volts (NEP-141), the marketplace, the packs and the race settlement, and it creates every player and AI-team account. This is a testnet build: there is no mainnet deployment.

Hackathon tracks entered: games, nfts, agents, security ([DECISIONS.md](DECISIONS.md) 1.2).

Reading order for a reviewer: sections 2 to 5 name the file behind each claim, and [docs/testnet-evidence.md](docs/testnet-evidence.md) lists a testnet transaction for each contract method called there.

## 1. Try it

Hosted build: `HOSTED_URL`. This is a placeholder: no deployment URL is recorded in the repository (BUILD_PLAN.md T15).

| Step | What to do                                                    | What you see                                                                                                                                                                                                                                                                                 | Code                                                                                                                                               |
| ---- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Open `HOSTED_URL`, select "Sign in", then "Play Demo"         | A new `PILOT_` user is signed in and sent to `/dashboard`. No wallet and no email. Limits: 5 demo accounts per IP per hour and `DEMO_ACCOUNT_CAP` in total                                                                                                                                   | [app/HeroSignIn.jsx](app/HeroSignIn.jsx), [app/login/LoginForm.jsx](app/login/LoginForm.jsx), [services/demo.service.js](services/demo.service.js) |
| 2    | Wait on the dashboard                                         | The panel "Setting up your pilot account" steps through "Creating your NEAR account", "Minting your starter drone, Ember skin, mod and 1,000 Volts" and "Binding the skin and mod to your drone", with the link "View your account on NearBlocks". The page reloads when the kit is on chain | [app/dashboard/BootstrapPanel.jsx](app/dashboard/BootstrapPanel.jsx), [services/bootstrap.service.js](services/bootstrap.service.js)               |
| 3    | Stay on the dashboard                                         | The starter drone is active from the start. The scheduler's next tick pairs it; the dashboard sections are "Active Drone Spotlight", "Next Race", "Live Race Feed" and "Your Recent Results"                                                                                                 | [app/dashboard/page.jsx](app/dashboard/page.jsx), [services/batch.service.js](services/batch.service.js)                                           |
| 4    | After the following tick, open "Races" and a race of your own | The race is settled. `HOSTED_URL/api/races/<race id>` returns the seed, both snapshots, the per-segment log and `settleExplorerUrl`; `HOSTED_URL/api/races/<race id>/verify` returns `{"data":{"match":true,...}}`                                                                           | [services/race.service.js](services/race.service.js), [app/api/races/[raceId]/verify/route.js](app/api/races/[raceId]/verify/route.js)             |
| 5    | Open `HOSTED_URL/api/health`                                  | `ok`, `database.ok`, `rpc.ok`, the last scheduler tick and its age in seconds, `racingEnabled`. Races run when `racingEnabled` is `true` and a scheduler calls the tick route every 3 minutes                                                                                                | [services/health.service.js](services/health.service.js)                                                                                           |

Timing: step 2 took 21 to 27 seconds in the recorded runs ([HANDOFF.md](HANDOFF.md), T8 and T10). A drone is matched by the first tick after its kit exists and its race is settled by the tick of the next slot, so with a scheduler that ticks at each slot start the first settled race arrives within 6 minutes.

The same things on NearBlocks:

- Your account: the link in step 2, or `user.nearAccountId` in `HOSTED_URL/api/auth/session`, at `https://testnet.nearblocks.io/address/<nearAccountId>`. The account is `p-<slug>.game.hyperdrome.testnet`, a sub-account the contract created.
- The starter kit: 7 transactions. `create_player`, `mint_drone`, `mint_item` (Ember skin), `mint_item` (a common mod) and `mint_volts` are signed by `hyperdrome.testnet` with the ops key; the two `bind` calls are signed by the player's own play key. A recorded run, account [p-pilotz4rx.game.hyperdrome.testnet](https://testnet.nearblocks.io/address/p-pilotz4rx.game.hyperdrome.testnet): [create_player](https://testnet.nearblocks.io/txns/CuJSi4XJsUuc4uRvfjgpBftxybjhJBYdLK1WEYPnSvgL), [mint_drone](https://testnet.nearblocks.io/txns/ASwAqUQJJZjW7Ny37Hnd3LQyLt4xLXg1rQHygtLkmx1E), [mint_item skin](https://testnet.nearblocks.io/txns/HVLBbPv4Lj4qeAw9LhHcNDJJJB7oSTrkCiMudZu3qo82), [mint_item mod](https://testnet.nearblocks.io/txns/DDGYCxSrhEuBEcDcqCSKj53qDfsaHqx7u2BW3c4AeVQa), [mint_volts](https://testnet.nearblocks.io/txns/43kViDa3XRJ7Bn2DrnWRhfyfQv6Ti5mSvReNj2KCaB9L), [bind skin](https://testnet.nearblocks.io/txns/CWkEhy8yVYKVhJzwDqhvq7583tByAdfqBQPqG1Hec9xY), [bind mod](https://testnet.nearblocks.io/txns/AkJsH85N691EEeacooHV9MJRDnTwJJyZCXf8GgZdhm5f).
- A settled race: `settleExplorerUrl` from step 4. A recorded one, race `ed3e44c7-7531-45c5-9efe-eac6096c77b7` in batch 9966119: [commit_batch](https://testnet.nearblocks.io/txns/GtrGtdg6KWS2z1QbNPdhvhDhd3HxhQ5jeHQrqN52bidW), then [settle_batch](https://testnet.nearblocks.io/txns/6mDqp7vPT5mJ8cfMtG8CHuJ2j7S8KuvZyzggkjFXW4Lg) in the next slot. The drone's ELO went from 1000 to 984 on chain (`get_drone` for `d:50`).

Without the hosted build, `npm run smoke` plays this loop against a local server and asserts each step ([scripts/smoke-testnet.mjs](scripts/smoke-testnet.mjs); its last report is in [HANDOFF.md](HANDOFF.md), T13).

## 2. What is on chain and what is not

The chain is the source of truth for the left column (contract state, and for access keys the accounts' own state); the database caches it and is refreshed from transaction events ([services/chain-cache.service.js](services/chain-cache.service.js)). [SPEC.md](SPEC.md) section 3.

| On chain (`game.hyperdrome.testnet`)                                                                         | Off chain (Postgres)                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Ownership of every drone, skin and mod (NEP-171 tokens `d:<n>`, `s:<n>`, `m:<n>`)                            | Profiles (Auth.js users); sessions are JWT cookies                                                                                   |
| Volt balances (NEP-141, 0 decimals); every mint, burn and transfer                                           | Which drones are active, and active slots                                                                                            |
| Per drone: 9 stats, level, XP, ELO, wins, losses, bound and equipped items                                   | Matchmaking inputs and the pairing itself, until it is committed                                                                     |
| Marketplace listings in escrow, the 10% fee, sales                                                           | The batch seed, sealed until settlement, then stored in the clear                                                                    |
| Pack commits and reveals; skin supply caps                                                                   | Race logs and the pre-race snapshots (not on chain; settlement checks each snapshot's stats hash against the drone's on-chain state) |
| Race batches: the seed hash, the matchups, the 120-second lock, the settled count                            | AI-team persona weights                                                                                                              |
| Payouts, ELO changes, XP and level-ups of every race                                                         | Sealed player keys                                                                                                                   |
| Player and team accounts and their access keys; AI-team spend caps and what each team has spent today        | Rate limits, the action log (`actions`), the scheduler's slot claims                                                                 |
| Every constant that affects settlement ([constants/](contracts/hyperdrome/src/constants), `get_constants()`) | Art, track names shown in the UI, and the cache of the contract's item catalog                                                       |

The race simulation itself runs on the server, not in the contract. What makes its result checkable is described next.

## 3. How a race works

1. Commit. The tick for slot `S = floor(unix_seconds / 180)` pairs the active drones the chain reports as free, draws a track, weather and time of day per race, and generates a 32-byte seed. The seed is stored sealed (AES-256-GCM) before anything is sent; only `sha256(seed)` goes on chain with the matchups in `commit_batch`. [services/batch.service.js](services/batch.service.js), [lib/game-engine/matchmaking.js](lib/game-engine/matchmaking.js), `commit_batch` in [settlement.rs](contracts/hyperdrome/src/settlement.rs).
2. Strategy window and lock. For 120 seconds after the commit's block time the owner can `equip` and `allocate_stats`. From then until the batch settles, those two calls and `nft_transfer` panic `locked`; `bind` still binds an item and skips its auto-equip. The rule is the contract's: `STRATEGY_WINDOW_MS` in [constants/mod.rs](contracts/hyperdrome/src/constants/mod.rs), `is_locked_at` in [math.rs](contracts/hyperdrome/src/math.rs), sandbox test `locked_drones_refuse_player_moves_until_settled` in [tests/settlement.rs](contracts/hyperdrome/tests/settlement.rs).
3. Engine. In the next slot the server reads each drone's on-chain stats and equipped items (the state the lock froze), stores that snapshot, and runs `simulateRace`. All randomness comes from xoshiro128\*\* seeded with `sha256(seed ++ "<batch>:<index>")`, so the same seed and snapshots give the same winner, times and log. [lib/game-engine/race-simulator.js](lib/game-engine/race-simulator.js), [prng.js](lib/game-engine/prng.js), [mods.js](lib/game-engine/mods.js); 1,000 identical runs and a golden set of 20 races in [tests/engine/race-simulator.test.js](tests/engine/race-simulator.test.js) and [tests/golden/races.json](tests/golden/races.json).
4. Settlement. `settle_batch(batch_id, seed, from, results)` is sent in chunks of 40 races. The contract checks `sha256(seed)` against the committed hash (`bad seed`), each result against its committed matchup (`bad chunk`), and each drone's `stats_hash` against its current on-chain state (`state drift`). It then computes the payouts, the ELO change (a fixed-point table), XP and level-ups from its own constants and the reported result, mints the Volts in one `ft_mint` event and emits `batch_settled`. The server supplies each race's winner and two times and no reward amount; the times decide only the dominance bonus of 0, 2 or 5 Volts. [services/settle.service.js](services/settle.service.js), [settlement.rs](contracts/hyperdrome/src/settlement.rs), [math.rs](contracts/hyperdrome/src/math.rs), [tests/settlement.rs](contracts/hyperdrome/tests/settlement.rs). A batch that cannot settle is aborted with `abort_batch`, which unlocks its drones and pays nothing ([example](https://testnet.nearblocks.io/txns/AC7UXVCFwesAkvkTU2SdJkyb2FaZXpzTGNZ9z77ktKL5)).
5. Verify. Once a race is settled, `GET /api/races/<id>` publishes its seed, snapshots and log, and `GET /api/races/<id>/verify` replays it on the server and compares winner, both times and the log. [services/race-schedule.service.js](services/race-schedule.service.js) (`verifyRace`), [services/race-replay.js](services/race-replay.js). The published seed can be checked against the chain: for the race in section 1 the seed `8d2535cde0c71a39b4a510fc5636927042569dfd162bce8238d109811fd3b7a0` hashes to `4e62153d815dda606dc7efd99d54da111be7e8c114da3669b639c880bdbe7d9b`, the `seed_hash` that `get_batch(9966119)` returns. The simulator and its imports use no Node module (the SHA-256 is [lib/game-engine/sha256.js](lib/game-engine/sha256.js)). In this build no page runs the replay; the check is the server route.

The scheduler that drives this is one HTTP route, `POST /api/races/run`, guarded by `CRON_SECRET` and by a unique `cron_ticks(slot)` row, so a doubled call does nothing ([services/scheduler.service.js](services/scheduler.service.js), [docs/runbooks/deploy.md](docs/runbooks/deploy.md)).

## 4. Tracks map

### games

| File                                                                             | What it shows                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [lib/game-engine/race-simulator.js](lib/game-engine/race-simulator.js)           | The simulator: 3 laps, straight and turn segments with 7 subtypes, weather and time-of-day multipliers, battery fade, per-segment noise scaled by a stat                                                                            |
| [lib/game-engine/mods.js](lib/game-engine/mods.js)                               | The equipped mod changes the stats a race runs with, and 3 legendary mods have a special effect, so the choice made in the strategy window changes the result. The 26 templates are in [templates.js](lib/game-engine/templates.js) |
| [lib/game-engine/matchmaking.js](lib/game-engine/matchmaking.js)                 | Level brackets, nearest-ELO pairing, no race between two drones of one owner, bot fill (rules carried over from the baseline, section 6)                                                                                            |
| [contracts/hyperdrome/src/settlement.rs](contracts/hyperdrome/src/settlement.rs) | Race results applied on chain: payouts, ELO, XP, level-ups                                                                                                                                                                          |
| [services/scheduler.service.js](services/scheduler.service.js)                   | The 3-minute tick: settle due batches, commit the next, then the AI teams                                                                                                                                                           |

### nfts

| File                                                                     | What it shows                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [contracts/hyperdrome/src/nft.rs](contracts/hyperdrome/src/nft.rs)       | NEP-171/177/178/181 with a hand-written transfer: a bound skin or mod cannot move alone, and a drone moves with every item bound to it in one event. Test `bound_items_move_only_with_their_drone` in [tests/sandbox.rs](contracts/hyperdrome/tests/sandbox.rs) |
| [contracts/hyperdrome/src/types.rs](contracts/hyperdrome/src/types.rs)   | Game state stored per token: stats, level, XP, ELO, record, bound and equipped items                                                                                                                                                                            |
| [contracts/hyperdrome/src/market.rs](contracts/hyperdrome/src/market.rs) | `list`, `buy`, `cancel` with escrow in the contract account, priced in Volts, 10% fee. Test `marketplace_escrows_sells_and_cancels` in [tests/gameplay.rs](contracts/hyperdrome/tests/gameplay.rs)                                                              |
| [contracts/hyperdrome/src/packs.rs](contracts/hyperdrome/src/packs.rs)   | Packs and capsules mint 3 items at reveal; catalog skins other than Ember have supply caps ([constants/catalog.rs](contracts/hyperdrome/src/constants/catalog.rs))                                                                                              |
| [services/metadata.service.js](services/metadata.service.js)             | NEP-177 token metadata and images served at `/api/metadata/<token>`                                                                                                                                                                                             |

The tokens are NEP-141 and NEP-171 from near-contract-standards 5.29.1, both in the one contract, not NEP-245: near-contract-standards has no NEP-245 implementation ([DECISIONS.md](DECISIONS.md) 2.2).

### agents

| File                                                                     | What it shows                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [lib/teams/policy.js](lib/teams/policy.js)                               | `decide`: the six rules a team applies in order, each a pure function of its state                                                                                                                                                                                                                                                                                              |
| [lib/game-engine/mod-fit.js](lib/game-engine/mod-fit.js)                 | The fit score of a mod for a race, from the track's straight and turn mix and the conditions                                                                                                                                                                                                                                                                                    |
| [services/teams.service.js](services/teams.service.js)                   | The runner: one action per team per tick (a capsule is two transactions, commit and reveal), signed with the team's own scoped key, under a deterministic action id so a repeated tick replays instead of acting twice                                                                                                                                                          |
| [contracts/hyperdrome/src/player.rs](contracts/hyperdrome/src/player.rs) | `spend` and `charge_team_cap`: every Volt debit a player method makes for a team account (`allocate_stats`, `buy`, `open_pack`, `vendor_buy_drone`) is checked on chain against its per-transaction and per-day cap. `ft_transfer` is outside the play key's reach. Test `team_spend_goes_through_on_chain_caps` in [tests/gameplay.rs](contracts/hyperdrome/tests/gameplay.rs) |
| [lib/teams/roster.js](lib/teams/roster.js)                               | The four teams: account slug, persona weights, starting kit                                                                                                                                                                                                                                                                                                                     |

### security

Custody model ([SPEC.md](SPEC.md) 4.1): players sign in with Google or Play Demo and hold no key. The server holds each player's keys, so the design limits what a held key can do.

| File                                                                                                                      | What it shows                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [contracts/hyperdrome/src/owner.rs](contracts/hyperdrome/src/owner.rs)                                                    | `create_player`: the contract creates `p-<slug>.game.hyperdrome.testnet` with two keys, an admin full-access key and a play function-call key that can call 9 methods on the game contract and nothing else. `nft_transfer` and `ft_transfer` need a 1 yocto deposit, which a function-call key cannot attach. Test `create_player_makes_account_with_two_scoped_keys` in [tests/sandbox.rs](contracts/hyperdrome/tests/sandbox.rs) |
| [lib/near/keys.js](lib/near/keys.js)                                                                                      | Keys at rest: AES-256-GCM with the account id as associated data, play keys under `KEY_ENCRYPTION_KEY` and admin keys under a separate `ADMIN_KEY_ENCRYPTION_KEY`. [tests/near/keys.test.js](tests/near/keys.test.js)                                                                                                                                                                                                               |
| [lib/near/play-key.js](lib/near/play-key.js)                                                                              | Rotation: one transaction deletes the old play key and adds a new one. `rotatePlayKey` in [lib/near/adapter.js](lib/near/adapter.js) is the only code that opens an admin key ([example](https://testnet.nearblocks.io/txns/asbxnwFq5ow79gSmfSYNdR5tg7M4a648uCGVFYsywyU))                                                                                                                                                           |
| [contracts/hyperdrome/src/packs.rs](contracts/hyperdrome/src/packs.rs), [hashing.rs](contracts/hyperdrome/src/hashing.rs) | Commit-reveal for packs: `open_pack` stores `sha256(secret)` and the block height; `reveal_pack` must come in a later block and draws from `sha256(secret ++ random_seed ++ pack_id)`, so neither the server nor the block producer picks the items alone. Test `packs_commit_then_reveal_in_a_later_block` in [tests/gameplay.rs](contracts/hyperdrome/tests/gameplay.rs)                                                          |
| [contracts/hyperdrome/src/settlement.rs](contracts/hyperdrome/src/settlement.rs)                                          | The `stats_hash` drift check: a result computed from stats or items other than the drone's current on-chain state fails `state drift` and the whole call reverts. The app's mirror is [lib/game-engine/stats-hash.js](lib/game-engine/stats-hash.js), with shared vectors in [tests/golden/stats-hash.json](tests/golden/stats-hash.json)                                                                                           |
| [services/action.service.js](services/action.service.js)                                                                  | Idempotent actions: a client action id, one contract `seq` pinned per action (the contract rejects any other with `bad seq`), and the transaction hash stored before the broadcast, so a retry or a killed process cannot apply an action twice. [tests/gameplay/action.service.test.js](tests/gameplay/action.service.test.js)                                                                                                     |

The settlement key can call only `commit_batch`, `settle_batch` and `abort_batch`; the ops key only the 8 owner methods of section 7. The full-access keys of the two root accounts are used from the command line, for deploys and account administration, and are not loaded by the application. Threat model: [SPEC.md](SPEC.md) section 14 and [ENGINEERING.md](ENGINEERING.md) section 4. Route guards (Origin check, session, rate limit, strict Zod body): [lib/http/mutation.js](lib/http/mutation.js).

## 5. AI teams

Four teams play the same loop as players. They are rule-based; no LLM is called ([SPEC.md](SPEC.md) section 10). Each is an account the contract created. The roster gives a team 3 drones (levels 4, 5, 8) with 2 skins and 3 mods bound to them ([lib/teams/roster.js](lib/teams/roster.js)); it starts with 20,000 Volts (`TEAM_START_VOLTS` in [constants/mod.rs](contracts/hyperdrome/src/constants/mod.rs)).

| Team               | Account                                                                                                  | Heaviest persona weights                      |
| ------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Vortex Dynamics    | [vortex.game.hyperdrome.testnet](https://testnet.nearblocks.io/address/vortex.game.hyperdrome.testnet)   | speed 30, acceleration 20, wind resistance 12 |
| Nimbus Racing      | [nimbus.game.hyperdrome.testnet](https://testnet.nearblocks.io/address/nimbus.game.hyperdrome.testnet)   | night vision 22, rain handling 22             |
| Hairpin Collective | [hairpin.game.hyperdrome.testnet](https://testnet.nearblocks.io/address/hairpin.game.hyperdrome.testnet) | turning 30, durability 22, acceleration 14    |
| Static Union       | [static.game.hyperdrome.testnet](https://testnet.nearblocks.io/address/static.game.hyperdrome.testnet)   | battery capacity 24, consistency 24           |

Each tick, after the batch is committed, each team takes at most one action (one transaction, or two for a capsule), the first of these that applies: (a) equip the bound mod with the best fit for the race it was just matched into; (b) bind an unbound mod that beats the drone's best bound one; (c) allocate stat points along its persona weights; (d) open a starter mod capsule while it holds fewer than 6 unbound mods; (e) with 3 or more unbound mods, list the one that fits its races worst at 1.2x its rarity base price; (f) buy a listed mod whose fit beats the drone's best bound mod by 2 or more, at or under 0.8x its rarity base price. The team never plans to spend below a 5,000 Volt reserve.

The spend limits are the contract's, not the runner's: 5,000 Volts per transaction and 15,000 per day, checked in `charge_team_cap` on every debit a team's play key can make, and a team with no budget row can spend nothing. `get_team` returns the caps and the day's spend.

Recorded on testnet ([HANDOFF.md](HANDOFF.md), T12): [equip by Vortex](https://testnet.nearblocks.io/txns/6jx6aMphprotxUj6sXJ2U7QYsk6wfxCvVCR852PKxao5) (Light Frame for a rain race on Iron Ribbon), and a capsule by Nimbus, [open_pack](https://testnet.nearblocks.io/txns/D9vaQ4kMcWZ2yCFbeqmaAFENeLfSGu2QLSyYs5jT8LdS) then [reveal_pack](https://testnet.nearblocks.io/txns/91UxgmYRtK6XPEgE6ayKfT3jSkaExKzLFa6EMzEmfjyC). Steps (b), (c), (e) and (f) did not come up in the recorded ticks; they are covered by [tests/teams/](tests/teams).

Separately, 20 bots fill thin brackets. A bot is a drone owned by the contract account; it has no account, no key and no Volts, and its payouts are not minted ([lib/world/bot-roster.js](lib/world/bot-roster.js)).

## 6. Disclosure: built before and during the hackathon

- Hyperdrome existed before the hackathon as a MegaETH testnet prototype (hyperdrome.vercel.app): a Next.js app with Solidity contracts. That code is the baseline of this repository, tagged `pre-hackathon` (last commit 2026-05-26).
- The judged diff is https://github.com/Ali-Atlas/hyperdrome/compare/pre-hackathon...hackathon-submission. `hackathon-submission` is the tag of the submitted commit; before it exists the same diff is `pre-hackathon...main`.
- The first commit after the tag is dated 2026-11-02 (`git log --reverse pre-hackathon..main`).

Carried over from the baseline:

- All art. `git diff pre-hackathon main -- public` is empty.
- The page layouts, styles and UI components. The pages were edited to remove the wallet flow and were not redesigned; the new UI is the sign-in page ([app/login/](app/login)), the sign-in link on the landing page and the setup panel on the dashboard.
- The race engine's rules and its draw order (segments, subtypes, multipliers, noise). [tests/engine/race-simulator.test.js](tests/engine/race-simulator.test.js) ("baseline parity") runs the tagged simulator and the current one on the same random stream and compares 200 races.
- Game numbers: stat budget, costs, XP curve, payout formula, pack odds, the 16 tracks, the skin and mod catalogs ([SPEC.md](SPEC.md) section 2 marks the new ones).
- The matchmaking rules (brackets, ELO pairing, the same-owner rule), the Play Demo sign-in with its two limits, and the base of the database schema and of the read services (races, leaderboard, tracks).

Built during the hackathon:

- The contract and everything on chain: [contracts/hyperdrome/](contracts/hyperdrome). The baseline's Solidity project, wagmi, RainbowKit, viem and ethers were removed.
- The chain adapter: [lib/near/](lib/near).
- Google sign-in, the `/login` page, and the on-chain bootstrap that every new user, demo users included, now goes through: [services/bootstrap.service.js](services/bootstrap.service.js). The baseline signed in by email link, wallet or Play Demo.
- Seeded, replayable racing: the PRNG, mods that affect the race, the client-safe log ([lib/game-engine/](lib/game-engine)).
- The scheduler, commit and settlement services, and the verify route: [services/](services).
- The gameplay routes and the idempotent action path: [services/action.service.js](services/action.service.js).
- The AI teams: [lib/teams/](lib/teams), [services/teams.service.js](services/teams.service.js).
- The world seed, the health route and the smoke test; tests, CI and the documents at the repository root.

Not in this build:

- The drone detail, drones list and marketplace pages still call the baseline's routes for allocate, equip, bind, the vendor drone, list, buy, cancel, packs and capsules. Those routes were removed, or (allocate) now take another body, so those buttons fail. The new routes work and are exercised by `npm run smoke` and the walk recorded in [HANDOFF.md](HANDOFF.md) (T10).
- No page shows the settle transaction link or a verify button; both are served by the API (section 1, step 4). The race page's segment chart reads the baseline's log field, which races settled by this build do not fill.
- No Pusher event is sent; pages poll ([SPEC.md](SPEC.md) section 9). No email sign-in. No post-race skin drop and no milestone drones ([DECISIONS.md](DECISIONS.md) 2.39, 5.34).
- No NEAR Intents, Chain Signatures, Shade Agents, meta transactions or per-drone sub-accounts ([SPEC.md](SPEC.md) section 16). Players cannot export or claim the keys of their account.

## 7. Contract

- Account: [game.hyperdrome.testnet](https://testnet.nearblocks.io/address/game.hyperdrome.testnet). Owner and treasury: [hyperdrome.testnet](https://testnet.nearblocks.io/address/hyperdrome.testnet).
- Deployed code hash: `2ctpTSVNWEnpRFYuxcNjGSMhKL1YhwhsJ9TQrCmHL93D` ([deploy with `migrate`](https://testnet.nearblocks.io/txns/GnMVuZynZc9pivwguu1Zux4Y8T5KjcHinGk25exQ5as8), 2026-11-04, [HANDOFF.md](HANDOFF.md) T6b). It is the `code_hash` of the RPC `view_account` query for the account.
- Source: one crate, [contracts/hyperdrome/](contracts/hyperdrome), Rust 1.93.0, near-sdk 5.29.1. File map: [contracts/hyperdrome/README.md](contracts/hyperdrome/README.md). Behavior: [SPEC.md](SPEC.md) section 4.

Build and test, from `contracts/hyperdrome/`:

```sh
cargo near build non-reproducible-wasm   # target/near/hyperdrome.wasm
cargo test                               # 43 unit tests and 21 near-sandbox tests
cargo clippy --target wasm32-unknown-unknown -- -D warnings
cargo clippy --all-targets -- -D warnings
```

The sandbox tests build the wasm and download a local `neard` on first run; they need no testnet account.

Methods by the key that can call them ([SPEC.md](SPEC.md) 4.1 and 4.4):

| Caller                                                                | Methods                                                                                                                                                                         | Source                                                                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner (`hyperdrome.testnet`, ops function-call key)                   | `create_player`, `register_player`, `mint_drone`, `mint_item`, `mint_volts`, `set_team_budget`, `set_paused`, `set_base_uri`                                                    | [owner.rs](contracts/hyperdrome/src/owner.rs)                                                                                                   |
| Player or team (its play function-call key; every call carries `seq`) | `allocate_stats`, `equip`, `bind`, `list`, `buy`, `cancel`, `open_pack`, `reveal_pack`, `vendor_buy_drone`                                                                      | [player.rs](contracts/hyperdrome/src/player.rs), [market.rs](contracts/hyperdrome/src/market.rs), [packs.rs](contracts/hyperdrome/src/packs.rs) |
| Settlement (the contract account's own function-call key)             | `commit_batch`, `settle_batch`, `abort_batch`                                                                                                                                   | [settlement.rs](contracts/hyperdrome/src/settlement.rs)                                                                                         |
| Anyone (views)                                                        | `get_constants`, `get_player`, `get_drone(s)`, `get_item(s)`, `get_listing(s)`, `get_batch`, `get_team`, `get_catalog`, `stats_hash`, and the standard `ft_*` and `nft_*` views | [views.rs](contracts/hyperdrome/src/views.rs)                                                                                                   |

One testnet transaction for each method called on testnet, each checked through RPC: [docs/testnet-evidence.md](docs/testnet-evidence.md).

## 8. Run it yourself

Full steps: [docs/runbooks/dev-setup.md](docs/runbooks/dev-setup.md). Short form:

```sh
nvm install && npm ci            # Node 24 (.nvmrc); package.json needs >= 22.22.2
cp .env.example .env.local       # fill in the names below
npm run db:migrate               # applies drizzle/ to DATABASE_URL
npm run seed:world -- --racing-on   # 16 tracks, the racing switch, 20 bots, the catalog cache
npm run dev                      # http://localhost:3000
node scripts/tick.mjs            # one scheduler tick; a scheduler sends one every 3 minutes
npm run smoke                    # the end-to-end check; the recorded runs took 1 min 39 s and 3 min 32 s
```

`seed:world`, `tick.mjs` and `smoke` send transactions, so they need a contract and the keys for it. The keys of `game.hyperdrome.testnet` are not in the repository. To run the chain steps, deploy the crate to your own testnet account (runbook, "Contract"), add an ops and a settlement function-call key with the method lists of section 7, and point `NEAR_OWNER_ID` and `NEAR_GAME_ID` at it. The runbook shows the `add-key` form under "Rotate the settlement key's method list"; it has no step that creates the two keys from nothing. `npm run seed:teams` adds the four AI teams ([docs/runbooks/seed-teams.md](docs/runbooks/seed-teams.md)).

Without any testnet account, both test suites run:

```sh
export DATABASE_URL=postgresql://<a local Postgres>   # not Neon; see "Test database" in the runbook
npm run db:migrate && npm test                        # mock chain adapter, real Postgres
cd contracts/hyperdrome && cargo test                 # near-sandbox
```

Environment variable names ([SPEC.md](SPEC.md) section 15, [.env.example](.env.example); values are never committed):

`DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `CRON_SECRET`, `NEAR_NETWORK`, `NEAR_RPC_URL`, `NEAR_RPC_API_KEY`, `NEAR_RPC_FAILOVER_URL`, `NEAR_OWNER_ID`, `NEAR_GAME_ID`, `NEAR_OPS_KEY`, `NEAR_SETTLEMENT_KEY`, `KEY_ENCRYPTION_KEY`, `ADMIN_KEY_ENCRYPTION_KEY`, `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`, `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`, `NEXT_PUBLIC_EXPLORER_URL`, `ADMIN_EMAILS`, `DEMO_ACCOUNT_CAP`, `NEAR_ADAPTER`, `NEAR_TESTNET_INTEGRATION`, `SMOKE_BASE_URL`. No code in this build reads the six Pusher names.

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs three jobs. App: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run db:migrate`, `npm test`, `npm run build`. Security: gitleaks and `npm audit --audit-level=high`. Contract: `cargo fmt --check`, the two `cargo clippy` commands of section 7, `cargo test`, `cargo audit`.

## 9. Stack, license, documents

| Part     | Versions ([SPEC.md](SPEC.md) section 15, [package.json](package.json), [Cargo.toml](contracts/hyperdrome/Cargo.toml))                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contract | Rust 1.93.0, near-sdk and near-contract-standards 5.29.1, cargo-near 0.22.0, near-cli-rs 0.30.1; tests on near-sandbox 0.4.0 with near-api 0.8.6       |
| App      | Next.js 16.4.4, React 19.2.4, plain JavaScript with JSDoc types, Auth.js (next-auth 5.0.0-beta.32), Zod 4.6.7, Drizzle ORM on Postgres (Neon), Node 24 |
| Chain    | near-api-js 7.4.0, imported only inside [lib/near/](lib/near) (an ESLint rule enforces it). RPC: dRPC, then FastNear as failover. Explorer: NearBlocks |
| Tests    | Vitest 5.1.0 against a mock adapter and Postgres 17 in CI; contract tests as above                                                                     |

License: MIT, see [LICENSE](LICENSE).

| Document                                             | What it holds                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [SPEC.md](SPEC.md)                                   | Behavior, constants, contract interface, data model, routes, threat model. Source of truth |
| [BUILD_PLAN.md](BUILD_PLAN.md)                       | The task sequence                                                                          |
| [DECISIONS.md](DECISIONS.md)                         | Each design decision with its reason                                                       |
| [ENGINEERING.md](ENGINEERING.md)                     | Code, testing and security standards                                                       |
| [HANDOFF.md](HANDOFF.md)                             | One entry per task: what changed, what was verified, with testnet transaction links        |
| [docs/runbooks/](docs/runbooks/README.md)            | Setup, deploy and scheduler, team seeding                                                  |
| [docs/testnet-evidence.md](docs/testnet-evidence.md) | A checked testnet transaction per contract method                                          |
| [AGENTS.md](AGENTS.md)                               | The rules the coding agent worked under                                                    |
| [docs/archive/](docs/archive/README.md)              | Documents of the MegaETH prototype; none describes the current build                       |
