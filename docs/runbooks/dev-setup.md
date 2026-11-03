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

| Command                                                                         | What it checks                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                                                  | ESLint (`eslint-config-next`, `eslint:recommended`, `eslint-config-prettier`) on the whole repo, every rule as an error, 0 warnings allowed. Untouched baseline files have the rules they broke at the tag switched off; touching a file brings it under every rule. |
| `npm run format:check`                                                          | Prettier on the ratchet scope. `npm run format` writes the fixes. Baseline files outside the scope are left alone.                                                                                                                                                   |
| `npm run typecheck`                                                             | `tsc -p tsconfig.typecheck.json --noEmit`: strict JSDoc type checking of `types/`, `tests/` and `lib/near/`, plus the files they import.                                                                                                                             |
| `npm test`                                                                      | Vitest on `tests/**/*.test.js`. The baseline `npm run test:economy` stays separate until T4.                                                                                                                                                                         |
| `npm run build`                                                                 | `next build`. Needs `DATABASE_URL` at build time; a placeholder works.                                                                                                                                                                                               |
| `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`, `cargo audit` | Contract gates, in `contracts/hyperdrome/`. CI skips them until `contracts/hyperdrome/Cargo.toml` exists.                                                                                                                                                            |

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
