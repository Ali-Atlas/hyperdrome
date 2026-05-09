# Deploy Instructions — Phases A–D

Operator playbook for the contracts + metadata endpoints + batch mint scripts added on `feature/megaeth-testnet`. Steps run sequentially; each section assumes the previous one succeeded. All Solidity is OZ 5.2.0 + pragma `^0.8.20`, deployed to MegaETH testnet v2 (chain id 6343, Carrot RPC).

Prereqs in `.env.local`:
- `DEPLOYER_PRIVATE_KEY` — funded on MegaETH testnet
- `MEGAETH_RPC_URL=https://carrot.megaeth.com/rpc`
- `DATABASE_URL` — same Neon URL the app uses
- `NEXT_PUBLIC_DRONE_CONTRACT_ADDRESS` — already populated from Phase 1

The drone contract (`HyperdromeDrone`) is already deployed at the address in `.env.local`; do not redeploy it.

---

## 1. DB migration — adds NFT columns to `skins` and `mods`

Run **before** any batch mint. The skin/mod batch scripts UPDATE `tokenId`/`mintTxHash`/`mintedAt`; without the migration those columns don't exist yet.

```bash
npm run db:push
```

When prompted, accept the `ALTER TABLE` for both `skins` and `mods`. No data loss — all three new columns are nullable.

---

## 2. Deploy `HyperdromeVOLT` (ERC-20)

```bash
cd contracts
npx hardhat run scripts/deploy-volt.js --network megaethTestnet
```

Output ends with the `Set VOLT_CONTRACT_ADDRESS=0x...` line. Copy the address into `.env.local`:

```
VOLT_CONTRACT_ADDRESS=0x...
```

Production: add the same value to Vercel project env (Production scope) — the `/api/volt/balance` route reads it server-side.

---

## 3. Deploy `HyperdromeSkin` (ERC-721)

```bash
cd contracts
npx hardhat run scripts/deploy-skin.js --network megaethTestnet
```

Sets `baseURI` to `https://hyperdrome.vercel.app/api/skins/` automatically. Copy the printed address into `.env.local`:

```
SKIN_CONTRACT_ADDRESS=0x...
```

Production env: add to Vercel.

---

## 4. Deploy `HyperdromeMod` (ERC-721)

```bash
cd contracts
npx hardhat run scripts/deploy-mod.js --network megaethTestnet
```

Sets `baseURI` to `https://hyperdrome.vercel.app/api/mods/` automatically. Copy:

```
MOD_CONTRACT_ADDRESS=0x...
```

Production env: add to Vercel.

---

## 5. Batch mint existing drones (one-time backfill)

Only needed if drones in the DB still have `token_id IS NULL` (i.e. they were created before Phase 1 went live, or in dev). The script is safe to re-run — it skips already-minted drones.

Run from the project root (not `contracts/`):

```bash
node --env-file=.env.local scripts/batch-mint-drones.js
```

Mints every unminted drone to the deployer wallet (uniform recipient — demo / bot drones don't have player wallets). 200ms throttle between mints. Failures log per-drone and continue; the summary at the end lists any failures for retry.

---

## 6. Batch mint existing skins

```bash
node --env-file=.env.local scripts/batch-mint-skins.js
```

Same pattern as drones. Requires `SKIN_CONTRACT_ADDRESS` from step 3.

---

## 7. Batch mint existing mods

```bash
node --env-file=.env.local scripts/batch-mint-mods.js
```

Same pattern as drones. Requires `MOD_CONTRACT_ADDRESS` from step 4.

---

## Verification spot checks

After each contract deploys, confirm code is live:

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x<ADDRESS>","latest"],"id":1}' \
  https://carrot.megaeth.com/rpc
```

A non-`"0x"` `result` field means bytecode is present.

After batch mint, spot-check a metadata endpoint:

```bash
curl https://hyperdrome.vercel.app/api/skins/1
curl https://hyperdrome.vercel.app/api/mods/1
```

Each should return ERC-721 JSON with `name` / `description` / `image` / `attributes`.

After connecting a wallet in the app, the NavShell volt counter swaps from DB volts to on-chain VOLT. Use the connected-wallet UI to confirm `/api/volt/balance` returns a non-error response.
