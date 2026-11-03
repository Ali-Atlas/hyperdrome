# Deploy Instructions — Phases A–H

Operator playbook for the contracts + metadata endpoints + batch mint scripts added on `feature/megaeth-testnet`. Steps run sequentially; each section assumes the previous one succeeded. All Solidity is OZ 5.2.0 + pragma `^0.8.20`, deployed to MegaETH testnet v2 (chain id 6343, Carrot RPC).

Prereqs in `.env.local`:
- `DEPLOYER_PRIVATE_KEY` — funded on MegaETH testnet
- `MEGAETH_RPC_URL=https://carrot.megaeth.com/rpc`
- `DATABASE_URL` — same Neon URL the app uses
- `NEXT_PUBLIC_DRONE_CONTRACT_ADDRESS` — already populated from Phase 1

The drone contract (`HyperdromeDrone`) is already deployed at the address in `.env.local`; do not redeploy it.

---

## 1. DB migration — Phases C–G schema additions

Run **before** any batch mint or any chunk-2 deploy. New columns and a new table:
- `skins` / `mods` — `tokenId`, `mintTxHash`, `mintedAt` (Phases C/D)
- `marketplace_listings` — `onchainListingId`, `listTxHash` (Phase E)
- `races` — `epochId`, `settleTxHash` + index `idx_races_epoch_id` (Phase F)
- new table `pack_purchases` (Phase G)

```bash
npm run db:push
```

When prompted, accept all `ALTER TABLE` and `CREATE TABLE` statements. No data loss — every new column is nullable; the new table is empty on creation.

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

---

# Chunk 2: Phases E–H

These phases add the marketplace, race settlement, packs, and stat-upgrade VOLT burn. Phases A–D must already be deployed and the chunk-1 batch mints completed (so drones / skins / mods all carry tokenIds).

Run the chunk-2 `npm run db:push` (already covered in step 1 above) before any chunk-2 deploy.

## E. Deploy `HyperdromeMarketplace` (Phase E)

```bash
cd contracts
VOLT_CONTRACT_ADDRESS=0x... \
npx hardhat run scripts/deploy-marketplace.js --network megaethTestnet
```

Treasury defaults to the deployer wallet. Override with `TREASURY_ADDRESS=0x...` in the same shell if needed.

Save the printed address:

```
MARKETPLACE_CONTRACT_ADDRESS=0x...
```

Production env: add to Vercel. The marketplace service mirrors DB list / buy / cancel through this contract for any item that has a `tokenId`. No additional authorization is needed — the marketplace pulls NFTs via standard `approve` + `safeTransferFrom`, and pulls VOLT via standard `approve` + `transferFrom` on each call (the helper handles the per-call approves).

## F. Deploy `HyperdromeSettlement` (Phase F — IMMUTABLE)

**DEVIATION FROM SPEC:** Captain requested UUPS upgradeable. The installed OpenZeppelin contracts 5.2.0 lacks `OwnableUpgradeable` (lives in the separate `contracts-upgradeable` package, not installed) and ships `UUPSUpgradeable` + `ERC1967Proxy` with pragma `^0.8.22` (incompatible with the locked `^0.8.20`). Per Captain's fallback instruction, deployed as immutable. A future upgrade is a redeploy + DB pointer swap.

```bash
cd contracts
VOLT_CONTRACT_ADDRESS=0x... \
NEXT_PUBLIC_DRONE_CONTRACT_ADDRESS=0x... \
npx hardhat run scripts/deploy-settlement.js --network megaethTestnet
```

Save:

```
SETTLEMENT_CONTRACT_ADDRESS=0x...
```

**Required follow-up:** Authorize settlement to mint VOLT on behalf of race rewards.

```bash
cast send $VOLT_CONTRACT_ADDRESS "setMinter(address,bool)" $SETTLEMENT_CONTRACT_ADDRESS true \
  --rpc-url $MEGAETH_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
```

(or the equivalent via Hardhat console / a one-shot script — the deploy script prints the exact `cast` invocation.)

Without this grant, `settleEpoch` reverts on the first non-zero reward.

## G. Deploy `HyperdromePacks` (Phase G)

```bash
cd contracts
VOLT_CONTRACT_ADDRESS=0x... \
SKIN_CONTRACT_ADDRESS=0x... \
MOD_CONTRACT_ADDRESS=0x... \
npx hardhat run scripts/deploy-packs.js --network megaethTestnet
```

Save:

```
PACKS_CONTRACT_ADDRESS=0x...
```

**Required follow-up authorization (the deploy script prints these too):**

```bash
# Packs burns VOLT from buyer on reveal
cast send $VOLT_CONTRACT_ADDRESS "setBurner(address,bool)" $PACKS_CONTRACT_ADDRESS true \
  --rpc-url $MEGAETH_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY

# Packs mints fresh skin / mod NFTs to buyer on reveal
cast send $SKIN_CONTRACT_ADDRESS "setMinter(address,bool)" $PACKS_CONTRACT_ADDRESS true \
  --rpc-url $MEGAETH_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
cast send $MOD_CONTRACT_ADDRESS "setMinter(address,bool)" $PACKS_CONTRACT_ADDRESS true \
  --rpc-url $MEGAETH_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
```

**Set initial pack prices** (in 18-decimal wei). Adjust to match the off-chain pack prices in `services/pack.service.js#PACK_PRICES`:

```bash
# Tier ids: 0 = STARTER, 1 = PREMIUM, 2 = LEGENDARY
cast send $PACKS_CONTRACT_ADDRESS "setPackPrice(uint8,uint256)" 0 100000000000000000000 \
  --rpc-url $MEGAETH_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY   # 100 VOLT
cast send $PACKS_CONTRACT_ADDRESS "setPackPrice(uint8,uint256)" 1 250000000000000000000 \
  --rpc-url $MEGAETH_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY   # 250 VOLT
cast send $PACKS_CONTRACT_ADDRESS "setPackPrice(uint8,uint256)" 2 750000000000000000000 \
  --rpc-url $MEGAETH_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY   # 750 VOLT
```

`commitPack` reverts if the tier price is zero, so this step is required before `/api/packs/buy` will work.

## H. Stat upgrade VOLT burn (Phase H — no deploy)

No new contract. The deployer (= VOLT owner) calls `VOLT.burn` directly during stat upgrades for wallet-linked users. Make sure `VOLT_CONTRACT_ADDRESS` is set in `.env.local` and Vercel; the existing chunk-1 deploy of VOLT (with the Phase F mint/burn role extensions in source) is sufficient.

If VOLT was deployed before the Phase F minter / burner role extensions landed, redeploy VOLT and rerun the post-deploy authorization steps for settlement (F) and packs (G) against the new address. Update `VOLT_CONTRACT_ADDRESS` in `.env.local` and Vercel after the redeploy.

---

## Chunk-2 verification spot checks

After each contract deploys, the same `eth_getCode` curl from chunk 1 confirms bytecode.

After Phase F + the `setMinter` grant, trigger a manual cron tick and confirm:
- `races.epoch_id` and `races.settle_tx_hash` get populated for all races whose drones both carry tokenIds.
- The settlement contract's `EpochSettled` event fires once per cron tick.

After Phase G + the three `setMinter`/`setBurner` grants + `setPackPrice` calls, hit `/api/packs/buy` while logged in as a wallet-linked user and confirm:
- A new `pack_purchases` row appears with both `commit_tx_hash` and `reveal_tx_hash` populated.
- New `skins` / `mods` rows appear, owned by the buyer, with `token_id` set.
- The buyer's on-chain VOLT balance has dropped by the tier price.

After Phase H, perform a stat upgrade as a wallet-linked user; the response should include `upgradeTxHash` and the on-chain VOLT balance should have dropped by the upgrade cost. The DB `users.points` column also decrements (it's a shadow of on-chain VOLT, not authoritative).
