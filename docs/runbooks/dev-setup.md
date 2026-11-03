# Dev setup

Local setup for Hyperdrome on NEAR, on Linux or WSL. Versions match DECISIONS.md section 6.

## Install

### Node 24

The repo pins Node 24 in `.nvmrc`; `package.json` requires Node 22.22.2 or later.

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
nvm install    # reads .nvmrc
node -v        # v24.x
npm ci         # installs dependencies and the pre-commit hook (husky)
```

### Rust 1.93.0 and the wasm target

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup toolchain install 1.93.0 --component rustfmt --component clippy
rustup target add wasm32-unknown-unknown --toolchain 1.93.0
```

The contract pins the toolchain in `contracts/hyperdrome/rust-toolchain.toml` once it exists.

### cargo-near 0.22.0

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/download/cargo-near-v0.22.0/cargo-near-installer.sh | sh
cargo near --version
```

### near-cli-rs 0.30.1

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/near-cli-rs/releases/download/v0.30.1/near-cli-rs-installer.sh | sh
near --version
```

### gitleaks

The pre-commit hook fails without it. Install the latest release binary into `~/.local/bin` and check the checksum:

```sh
V=8.30.1   # latest at https://github.com/gitleaks/gitleaks/releases
cd "$(mktemp -d)"
curl -sSLO "https://github.com/gitleaks/gitleaks/releases/download/v${V}/gitleaks_${V}_linux_x64.tar.gz"
curl -sSLO "https://github.com/gitleaks/gitleaks/releases/download/v${V}/gitleaks_${V}_checksums.txt"
grep linux_x64.tar.gz "gitleaks_${V}_checksums.txt" | sha256sum -c -
tar -xzf "gitleaks_${V}_linux_x64.tar.gz" gitleaks
install -m 0755 gitleaks ~/.local/bin/gitleaks
gitleaks version
```

`~/.local/bin` must be on `PATH`.

## Gates

Each gate runs locally and in CI (`.github/workflows/ci.yml`). Scope follows the ratchet in ENGINEERING.md section 6: `scripts/changed-files.mjs` lists the files created or changed since the `pre-hackathon` tag, plus everything under `tests/`, `lib/near/` and `contracts/hyperdrome/`. Both lint and format:check need the tag, so CI checks out full history.

| Command                                                                                                                                                      | What it checks                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                                                                                                                               | ESLint (`eslint-config-next`, `eslint:recommended`, `eslint-config-prettier`) on the whole repo, every rule as an error, 0 warnings allowed. Untouched baseline files have the rules they broke at the tag switched off; touching a file brings it under every rule. |
| `npm run format:check`                                                                                                                                       | Prettier on the ratchet scope. `npm run format` writes the fixes. Baseline files outside the scope are left alone.                                                                                                                                                   |
| `npm run typecheck`                                                                                                                                          | `tsc -p tsconfig.typecheck.json --noEmit`: strict JSDoc type checking of `types/`, `tests/` and `lib/near/`, plus the files they import.                                                                                                                             |
| `npm test`                                                                                                                                                   | Vitest on `tests/**/*.test.js`. The baseline `npm run test:economy` stays separate until T4.                                                                                                                                                                         |
| `npm run build`                                                                                                                                              | `next build`. Needs `DATABASE_URL` at build time; a placeholder works.                                                                                                                                                                                               |
| `cargo fmt --check`, `cargo clippy --target wasm32-unknown-unknown -- -D warnings`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `cargo audit` | Contract gates, in `contracts/hyperdrome/` (see Contract below). Plain `cargo clippy` cannot compile: near-sdk 5.27+ refuses a host build that is not a test build.                                                                                                  |     |

CI also runs gitleaks over the full history and `npm audit --audit-level=high`. The audit step reports without failing until T8 removes the MegaETH dependencies.

### Pre-commit hook

husky runs `.husky/pre-commit` on every commit:

1. lint-staged (`.lintstagedrc.json`): `eslint --fix --max-warnings=0` and `prettier --write` on staged `*.{js,jsx,mjs}`; `prettier --write` on staged `*.{json,md,css}`.
2. `gitleaks protect --staged --redact`: blocks the commit if a staged change contains a secret.

## Environment variables

Never commit a `.env*` file; `.env.example` is the template. Copy it to `.env.local` for local runs. `types/env.d.ts` declares the same keys for type checking.

### Build-time placeholders (CI)

| Variable                  | CI value                                                                    |
| ------------------------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`            | `postgresql://ci:ci@localhost:5432/ci` (placeholder, no database behind it) |
| `NEXT_TELEMETRY_DISABLED` | `1`                                                                         |

### Read by the app today

| Variable            | Purpose                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `DATABASE_URL`      | Neon Postgres pooled connection string. Required at build time.                          |
| `PROD_DATABASE_URL` | Production database for the ops scripts in `scripts/` and `lib/onchain/`.                |
| `NEXTAUTH_SECRET`   | Auth.js session encryption secret.                                                       |
| `NEXTAUTH_URL`      | Canonical public URL for Auth.js; read by the library, listed in `.env.example`.         |
| `RESEND_API_KEY`    | Resend key for magic-link email.                                                         |
| `CRON_SECRET`       | Shared secret for the race cron endpoint.                                                |
| `ADMIN_EMAILS`      | Comma-separated admin allowlist.                                                         |
| `ALLOW_LOCAL_SEED`  | Set by `npm run seed:dev` so the production seed script runs against the local database. |
| `NODE_ENV`          | Set by Next.js and Node tooling.                                                         |

### MegaETH baseline (removed in T8)

`DEPLOYER_PRIVATE_KEY`, `MEGAETH_RPC_URL`, `TREASURY_ADDRESS`, `DRONE_CONTRACT_ADDRESS`, `VOLT_CONTRACT_ADDRESS`, `SKIN_CONTRACT_ADDRESS`, `MOD_CONTRACT_ADDRESS`, `MARKETPLACE_CONTRACT_ADDRESS`, `SETTLEMENT_CONTRACT_ADDRESS`, `PACKS_CONTRACT_ADDRESS`, `NEXT_PUBLIC_DRONE_CONTRACT_ADDRESS`, `NEXT_PUBLIC_VOLT_CONTRACT_ADDRESS`, `NEXT_PUBLIC_MARKETPLACE_CONTRACT_ADDRESS`.

## NEAR testnet

Accounts and keys created in T2 and T3 (DECISIONS.md 3.6). Testnet only. Explorer links:

| Account                           | Role                        | Explorer                                                              |
| --------------------------------- | --------------------------- | --------------------------------------------------------------------- |
| `hyperdrome.testnet`              | Parent account and treasury | https://testnet.nearblocks.io/address/hyperdrome.testnet              |
| `game.hyperdrome.testnet`         | Game contract account       | https://testnet.nearblocks.io/address/game.hyperdrome.testnet         |
| `p-smoke.game.hyperdrome.testnet` | T3 smoke player             | https://testnet.nearblocks.io/address/p-smoke.game.hyperdrome.testnet |

Transactions: `https://testnet.nearblocks.io/txns/<hash>`.

### Where keys live

Keys live only in `~/.near-credentials/testnet/` on the operator's machine (near-cli-rs legacy keychain), mode 600, never in the repo.

| File                                                                                 | Key                                                            | Permission                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hyperdrome.testnet.json` (and `hyperdrome.testnet/ed25519_<pubkey>.json`)           | Parent account key                                             | Full access                                                                                                                                                                                 |
| `game.hyperdrome.testnet.json` (and `game.hyperdrome.testnet/ed25519_<pubkey>.json`) | Contract account key, for deploys and account administration   | Full access                                                                                                                                                                                 |
| `hyperdrome.testnet-settlement.json`                                                 | Settlement signer on `game.hyperdrome.testnet`                 | Function call: `commit_batch`, `settle_batch` on `game.hyperdrome.testnet`, allowance 5 NEAR                                                                                                |
| `hyperdrome.testnet-ops.json`                                                        | Ops key on `hyperdrome.testnet` (the owner), for owner methods | Function call: `create_player`, `register_player`, `mint_drone`, `mint_item`, `mint_volts`, `set_team_budget`, `set_paused`, `set_base_uri` on `game.hyperdrome.testnet`, allowance 10 NEAR |
| `p-smoke.game.hyperdrome.testnet-admin.json`, `-play.json`                           | Smoke player's admin and play keys                             | Full access; function call on the play methods, allowance 1 NEAR                                                                                                                            |

Full-access keys are never loaded by application code (ENGINEERING.md section 4).

### Check the accounts

```sh
near account view-account-summary hyperdrome.testnet network-config testnet now
near account list-keys game.hyperdrome.testnet network-config testnet now
```

### Top up

- Parent: request testnet NEAR at https://near-faucet.io for `hyperdrome.testnet`. near-cli-rs can also create a faucet-sponsored helper account and delete it with the parent as beneficiary, which moves the helper's balance to the parent:

  ```sh
  near account create-account sponsor-by-faucet-service hd-fund-1.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
  near account delete-account hd-fund-1.testnet beneficiary hyperdrome.testnet network-config testnet sign-with-legacy-keychain send
  ```

- Contract account, from the parent:

  ```sh
  near tokens hyperdrome.testnet send-near game.hyperdrome.testnet '10 NEAR' network-config testnet sign-with-legacy-keychain send
  ```

- Settlement and ops key allowances: an allowance cannot be raised in place. Add a new function-call key with the same contract and methods, then delete the old one (key rotation runbook, `docs/runbooks/key-rotation.md`, once written).

### Export a key for the app's env

`export-account ... using-private-key` prints the private key the keychain holds for an account. For both accounts that is the **full-access** key, so use it for deploys and administration only, never in the app's env:

```sh
near account export-account game.hyperdrome.testnet using-private-key network-config testnet
```

The app signs with the function-call keys, which are not in the keychain's account files. Read each from its own file:

```sh
node -p "require(process.env.HOME + '/.near-credentials/testnet/hyperdrome.testnet-settlement.json').private_key"  # NEAR_SETTLEMENT_KEY
node -p "require(process.env.HOME + '/.near-credentials/testnet/hyperdrome.testnet-ops.json').private_key"         # NEAR_OPS_KEY
```

Paste each value into the app's env (Vercel encrypted env vars `NEAR_SETTLEMENT_KEY` and `NEAR_OPS_KEY`, SPEC.md 15) and never into a committed file. Clear the terminal afterwards.

## Contract

The crate is `contracts/hyperdrome` (SPEC.md 4). Run these from that directory with `~/.cargo/bin` on `PATH` (`. "$HOME/.cargo/env"`).

### Build and test

```sh
cargo near build non-reproducible-wasm                   # target/near/hyperdrome.wasm and the ABI
cargo test                                               # unit tests and near-sandbox tests
cargo clippy --target wasm32-unknown-unknown -- -D warnings
cargo clippy --all-targets -- -D warnings
cargo fmt --check
cargo audit                                              # .cargo/audit.toml lists the one ignored advisory and why
```

The sandbox tests build the wasm with cargo-near-build and download a neard sandbox binary on first run. They print the gas burnt by `create_player`, `mint_drone` and `bind` and assert the SPEC.md 13 budgets.

### Deploy

First deploy (runs `new`), signed by the contract account's full-access key:

```sh
cargo near deploy build-non-reproducible-wasm game.hyperdrome.testnet \
  with-init-call new json-args '{"owner_id":"hyperdrome.testnet","treasury_id":"hyperdrome.testnet"}' \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
```

Upgrade (keeps state; `migrate` is `#[private]`, so it runs in the deploy transaction):

```sh
cargo near deploy build-non-reproducible-wasm game.hyperdrome.testnet \
  with-init-call migrate json-args '{}' \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
```

### Owner calls with the ops key

Owner methods take no deposit, so the ops function-call key signs them:

```sh
near contract call-function as-transaction game.hyperdrome.testnet mint_volts \
  json-args '{"to":"p-smoke.game.hyperdrome.testnet","amount":"1000"}' \
  prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as hyperdrome.testnet network-config testnet \
  sign-with-access-key-file ~/.near-credentials/testnet/hyperdrome.testnet-ops.json send
```

Views need no key:

```sh
near contract call-function as-read-only game.hyperdrome.testnet nft_tokens_for_owner \
  json-args '{"account_id":"p-smoke.game.hyperdrome.testnet"}' network-config testnet now
```

New keypairs (ops, settlement, a player's admin and play keys) are generated locally and written straight to `~/.near-credentials/testnet/<name>.json` with mode 600, one file per role, so each is easy to find, export and rotate. Only the public key is printed; it is registered with `add-key ... use-manually-provided-public-key` or passed to `create_player`. (near-cli-rs's own `save-to-legacy-keychain` never overwrites an existing `<account>.json`; it adds the key under `<account>/`, next to the full-access keys.)
