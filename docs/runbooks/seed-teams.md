# Seed the AI teams

Creates the 4 AI racing teams of SPEC.md 10 on the chain and in the database that `.env.local` points at: account, on-chain budget, 3 drones, 2 skins, 3 mods, 20,000 Volts, 2 NEAR for gas and a play key with a 2 NEAR allowance. Run it once per environment, after the contract is deployed and the database is migrated.

## Before

- `.env.local` has `DATABASE_URL`, `NEAR_OWNER_ID`, `NEAR_GAME_ID`, `NEAR_OPS_KEY`, `NEAR_SETTLEMENT_KEY`, `KEY_ENCRYPTION_KEY` and `ADMIN_KEY_ENCRYPTION_KEY` (docs/runbooks/dev-setup.md).
- The owner account holds at least 10 NEAR before each gas transfer (8 NEAR leave it in total):

  ```sh
  near account view-account-summary hyperdrome.testnet network-config testnet now
  ```

- Nothing else is using the ops key (a second process makes its nonce stale, SPEC.md 6).

## Run

```sh
npm run seed:teams              # every team
npm run seed:teams -- vortex    # only the named teams
```

The script prints one line per transaction with its explorer link. For each team it stops once and prints a command like this, then waits (it checks the balance every 5 s, for up to 30 minutes):

```sh
near tokens hyperdrome.testnet send-near vortex.game.hyperdrome.testnet '2 NEAR' network-config testnet sign-with-legacy-keychain send
```

Run that command in a second terminal. It is signed with the owner's full-access key from the near-cli-rs legacy keychain; the application never loads that key. When the 2 NEAR arrive the script rotates the team's play key to a 2 NEAR allowance and moves on to the next team.

## Run it again

The script is idempotent. A finished team is skipped with no chain call. A run that stopped (an RPC failure, a closed terminal, the 30 minute wait) resumes where it stopped: it reads the chain first and mints or binds only what is missing. A message that starts with `stopped.` says what it is waiting for.

- `holds under 10 NEAR`: fund the owner account (dev-setup.md, "Top up"), then run again.
- `returned no outcome`, `has an unknown outcome`, `still has no outcome`: a transaction was sent and its answer did not come back. Its hash (and, for an account creation, the sealed keys) is stored on the team's `users` row. Run again in a minute; the stored transaction is resolved before anything new is sent. A mint the RPC still does not know after 10 minutes counts as dropped and is sent again.
- `the chain views do not show ... yet`: an RPC node is behind. Run again in a minute.
- `exists on chain but this database holds no keys for it`: the team account was created from another database. Its keys are in that database's `users` row; this one cannot adopt the account.

## After a roster change

`lib/teams/roster.js` is the kit. When it gains a skin or a mod, bring the seeded teams up to it:

```sh
npm run seed:teams -- --reconcile
```

For each seeded team this mints and binds the roster's items the team does not have yet, through the same steps as the seed, and rebuilds the cache. It never mints Volts, sends gas or rotates the key. Binds are permanent: an item the roster no longer lists stays on its drone.

## Check

```sh
near contract call-function as-read-only game.hyperdrome.testnet get_player json-args '{"account":"vortex.game.hyperdrome.testnet"}' network-config testnet now
near contract call-function as-read-only game.hyperdrome.testnet get_team json-args '{"account":"vortex.game.hyperdrome.testnet"}' network-config testnet now
near contract call-function as-read-only game.hyperdrome.testnet ft_balance_of json-args '{"account_id":"vortex.game.hyperdrome.testnet"}' network-config testnet now
near account list-keys vortex.game.hyperdrome.testnet network-config testnet now
```

`get_player` shows `is_team: true`; `get_team` shows `per_tx` 5000 and `per_day` 15000; the balance is 20000; the key list shows one full-access key (the admin key) and one function-call key with a 2 NEAR allowance.
