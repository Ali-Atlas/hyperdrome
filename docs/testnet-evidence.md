# Testnet evidence

One transaction on NEAR testnet for each contract method that has been called there, plus the deploy, the key rotations and two refusals. Contract: `game.hyperdrome.testnet`. The runs these come from are described in [HANDOFF.md](../HANDOFF.md).

Every row was checked on 2026-11-05 with the RPC `tx` query against an archival node: the signer, the method and the final status below are what the node returned. To repeat a check:

```sh
curl -s https://archival-rpc.testnet.fastnear.com -H 'content-type: application/json' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "tx",
  "params": { "tx_hash": "<hash>", "sender_account_id": "<signer>", "wait_until": "NONE" }
}'
```

Short names: owner = `hyperdrome.testnet`, game = `game.hyperdrome.testnet`, and a player or team name stands for `<name>.game.hyperdrome.testnet`.

## Owner methods (ops key on the owner account)

| Method            | Signer | What it did                                      | Status  | Transaction                                                                                    |
| ----------------- | ------ | ------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------- |
| `create_player`   | owner  | Created player `p-pilotz4rx` with its two keys   | Success | [CuJSi4XJ...](https://testnet.nearblocks.io/txns/CuJSi4XJsUuc4uRvfjgpBftxybjhJBYdLK1WEYPnSvgL) |
| `create_player`   | owner  | Created team `vortex` (`is_team: true`)          | Success | [HvT1S6jc...](https://testnet.nearblocks.io/txns/HvT1S6jczGT4Fc3aGCkuuW3NcDdcNz3Q8ZaBdTCfJnXP) |
| `mint_drone`      | owner  | Starter drone `d:6` for `p-pilotz4rx`            | Success | [ASwAqUQJ...](https://testnet.nearblocks.io/txns/ASwAqUQJJZjW7Ny37Hnd3LQyLt4xLXg1rQHygtLkmx1E) |
| `mint_drone`      | owner  | Bot `d:29`, owned by the game account            | Success | [v5dKMoRi...](https://testnet.nearblocks.io/txns/v5dKMoRifEb1G9kYCu3kcYJj79L4y2QJCkdW3md79gR)  |
| `mint_item`       | owner  | Ember skin `s:2`                                 | Success | [HVLBbPv4...](https://testnet.nearblocks.io/txns/HVLBbPv4Lj4qeAw9LhHcNDJJJB7oSTrkCiMudZu3qo82) |
| `mint_item`       | owner  | Common mod `m:12`                                | Success | [DDGYCxSr...](https://testnet.nearblocks.io/txns/DDGYCxSrhEuBEcDcqCSKj53qDfsaHqx7u2BW3c4AeVQa) |
| `mint_volts`      | owner  | 1,000 starter Volts                              | Success | [43kViDa3...](https://testnet.nearblocks.io/txns/43kViDa3XRJ7Bn2DrnWRhfyfQv6Ti5mSvReNj2KCaB9L) |
| `set_team_budget` | owner  | Caps of 5,000 per transaction and 15,000 per day | Success | [bZzEP7F1...](https://testnet.nearblocks.io/txns/bZzEP7F1fuYXArmU73wQLj5jQfq7acevKNGMKPnFcQR)  |

`register_player`, `set_paused` and `set_base_uri` have no recorded testnet call. The sandbox tests call them: `set_paused` and `set_base_uri` in [tests/sandbox.rs](../contracts/hyperdrome/tests/sandbox.rs) (and `set_paused` in [tests/gameplay.rs](../contracts/hyperdrome/tests/gameplay.rs)), `register_player` in [tests/settlement_budget.rs](../contracts/hyperdrome/tests/settlement_budget.rs).

## Player methods (the account's own play key)

| Method             | Signer        | What it did                                        | Status  | Transaction                                                                                    |
| ------------------ | ------------- | -------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `bind`             | `p-pilotz4rx` | Bound the starter skin `s:2` to `d:6`              | Success | [CWkEhy8y...](https://testnet.nearblocks.io/txns/CWkEhy8yVYKVhJzwDqhvq7583tByAdfqBQPqG1Hec9xY) |
| `bind`             | `p-pilotz4rx` | Bound the starter mod `m:12` to `d:6`              | Success | [AkJsH85N...](https://testnet.nearblocks.io/txns/AkJsH85N691EEeacooHV9MJRDnTwJJyZCXf8GgZdhm5f) |
| `allocate_stats`   | `p-pilotiilc` | Spent the 20 starter points on `d:50`              | Success | [FizwNrRq...](https://testnet.nearblocks.io/txns/FizwNrRqYsn5czi14P7AQ9JepcsV97dEJisa7FHPYfTy) |
| `equip`            | `p-pilotiilc` | Equipped mod `m:45` on `d:50`                      | Success | [D5ue75NL...](https://testnet.nearblocks.io/txns/D5ue75NL7VfMLfptJ5MUw4e5ybeVRB7jqL7byoGp9hEF) |
| `list`             | `p-pilotkf1x` | Listed drone `d:8` at 100 Volts (escrow)           | Success | [9MWAoAGT...](https://testnet.nearblocks.io/txns/9MWAoAGTTnLLUUAR1ZsrBbdTbkVPh7yMVTffB5gpRfS3) |
| `buy`              | `p-pilote7sl` | Bought `d:8`; its bound skin and mod moved with it | Success | [FYmkhpB6...](https://testnet.nearblocks.io/txns/FYmkhpB6E9HSoWzkarFDfJkbfc7uPdqEjgBFCiCzXdfh) |
| `cancel`           | `p-pilotkf1x` | Cancelled the listing of mod `m:16`                | Success | [9YXwmvUy...](https://testnet.nearblocks.io/txns/9YXwmvUyepHzPpb9iouJ5nKhZpGJmWMabAiKBEgcWbyw) |
| `open_pack`        | `p-pilotkf1x` | Committed a starter mod capsule (pack 2)           | Success | [CfSev5oi...](https://testnet.nearblocks.io/txns/CfSev5oieXKeNpagdVnFuS7UnrLajLoAHqbbUYLNNXM7) |
| `reveal_pack`      | `p-pilotkf1x` | Revealed pack 2: minted `m:15`, `m:16`, `m:17`     | Success | [8QaafunS...](https://testnet.nearblocks.io/txns/8QaafunSnbCmxaTpqjQ76Tw6aGBfMacq2YKbf6o28DGv) |
| `vendor_buy_drone` | `p-pilotkf1x` | Bought vendor drone `d:8` for 3,500 Volts          | Success | [5gyFh6SG...](https://testnet.nearblocks.io/txns/5gyFh6SGf5iHg5zVaWx6KvrGfNpLZ5Vu1pwTTf679vcX) |

## Settlement methods (function-call key on the game account)

| Method         | Signer | What it did                                          | Status  | Transaction                                                                                    |
| -------------- | ------ | ---------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `commit_batch` | game   | Committed batch 9966119 (9 races) with its seed hash | Success | [GtrGtdg6...](https://testnet.nearblocks.io/txns/GtrGtdg6KWS2z1QbNPdhvhDhd3HxhQ5jeHQrqN52bidW) |
| `settle_batch` | game   | Settled batch 9966119 in one chunk                   | Success | [6mDqp7vP...](https://testnet.nearblocks.io/txns/6mDqp7vPT5mJ8cfMtG8CHuJ2j7S8KuvZyzggkjFXW4Lg) |
| `commit_batch` | game   | Committed batch 9966125 (9 races, 8 with a team)     | Success | [7ZrcrGAw...](https://testnet.nearblocks.io/txns/7ZrcrGAwn7D3WuPuW7UPQ77E3CP2QkdsUBNYEFHCxiRN) |
| `settle_batch` | game   | Settled batch 9966125                                | Success | [2uTyybK4...](https://testnet.nearblocks.io/txns/2uTyybK49aFvoz6QCgdHJ15dGmP7uAUthFkrXAXqMpcm) |
| `abort_batch`  | game   | Aborted batch 2: 2 drones unlocked, nothing minted   | Success | [AC7UXVCF...](https://testnet.nearblocks.io/txns/AC7UXVCFwesAkvkTU2SdJkyb2FaZXpzTGNZ9z77ktKL5) |

## AI team actions (each team's own play key)

| Method        | Signer   | What it did                                                          | Status  | Transaction                                                                                    |
| ------------- | -------- | -------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `equip`       | `vortex` | Equipped Light Frame `m:33` on `d:19` for a rain race on Iron Ribbon | Success | [6jx6aMph...](https://testnet.nearblocks.io/txns/6jx6aMphprotxUj6sXJ2U7QYsk6wfxCvVCR852PKxao5) |
| `open_pack`   | `nimbus` | Committed a starter mod capsule (pack 6)                             | Success | [D9vaQ4kM...](https://testnet.nearblocks.io/txns/D9vaQ4kMcWZ2yCFbeqmaAFENeLfSGu2QLSyYs5jT8LdS) |
| `reveal_pack` | `nimbus` | Revealed pack 6: minted `m:48`, `m:49`, `m:50`                       | Success | [91UxgmYR...](https://testnet.nearblocks.io/txns/91UxgmYRtK6XPEgE6ayKfT3jSkaExKzLFa6EMzEmfjyC) |

## Linked wallets (T16)

Checked with the RPC `tx` query on 2026-11-08. `wallet` = `t16w828691eca0.hyperdrome.testnet`, player = `p-piloto3ti.game.hyperdrome.testnet`.

| Method          | Signer | What it did                                                     | Status  | Transaction                                                                                    |
| --------------- | ------ | --------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `link_wallet`   | owner  | Linked `wallet` to the player after a NEP-413 proof             | Success | [8WFcKLGn...](https://testnet.nearblocks.io/txns/8WFcKLGnN9DtEkHUBYA9QaZpc6smLEaqCCmbbGFLe8JQ) |
| `withdraw`      | owner  | Moved `d:57` with `s:32` and `m:81`, and 100 Volts, to `wallet` | Success | [CPbbrxbi...](https://testnet.nearblocks.io/txns/CPbbrxbiCmAsd8HbgFoKWM5fh2GimhnqC8NygvKaUB8k) |
| `withdraw`      | wallet | Moved `m:82` and 25 Volts, signed by the wallet with 1 yocto    | Success | [286b3Gbm...](https://testnet.nearblocks.io/txns/286b3Gbm3emkAs2tSCARv4MfhWwQyitqPcdF42FpATc3) |
| `unlink_wallet` | wallet | Removed the link, signed by the wallet with 1 yocto             | Success | [HKHf4P6e...](https://testnet.nearblocks.io/txns/HKHf4P6eHTQqH16r8RjwrSvDshkmApUSDqNxh9zeye5N) |

## Deploy and keys

| Action            | Signer   | What it did                                                                                        | Status  | Transaction                                                                                    |
| ----------------- | -------- | -------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| DeployContract    | game     | Deployed code hash `2ctpTSVNWEnpRFYuxcNjGSMhKL1YhwhsJ9TQrCmHL93D` with `migrate`                   | Success | [GnMVuZyn...](https://testnet.nearblocks.io/txns/GnMVuZynZc9pivwguu1Zux4Y8T5KjcHinGk25exQ5as8) |
| DeleteKey, AddKey | `vortex` | Play key rotation in one transaction (`rotatePlayKey`)                                             | Success | [asbxnwFq...](https://testnet.nearblocks.io/txns/asbxnwFq5ow79gSmfSYNdR5tg7M4a648uCGVFYsywyU)  |
| DeleteKey         | game     | Settlement key removed, to change its method list                                                  | Success | [C8aArL2D...](https://testnet.nearblocks.io/txns/C8aArL2DpG4N31SdV4CQ8W2rDkmYrLj6ZnYejpJccAnX) |
| AddKey            | game     | Settlement key added back with `commit_batch`, `settle_batch`, `abort_batch`                       | Success | [7VVUxQDt...](https://testnet.nearblocks.io/txns/7VVUxQDtUrsfM2Pyo65i55C2WuSQHhF2CGFSfmxt75Sb) |
| DeployContract    | game     | Deployed code hash `9Dz987fhyJ881jh7QoMpwevfaqvYxxdTYQT6pB3niQbX` with `migrate` (T16, 2026-11-08) | Success | [CbCZ8U7V...](https://testnet.nearblocks.io/txns/CbCZ8U7VHffeGrBHU7moiHMVBRCkk9xT3LDVqXJFrj4T) |
| DeleteKey         | owner    | Ops key removed to change its method list (T16)                                                    | Success | [78u6npYk...](https://testnet.nearblocks.io/txns/78u6npYkxGWDsd5cug7NxkBaXcreRBRasxpX9ABWRE7H) |
| AddKey            | owner    | Ops key added back with `link_wallet` and `withdraw` (T16)                                         | Success | [F2gZTR7s...](https://testnet.nearblocks.io/txns/F2gZTR7sqh9hs5zuRAoS4iDrVvq7ExC3xqm1BZ7PMh62) |
| DeployContract    | game     | Deployed code hash `FFnSTQaFQJaR3xBu8ZCeZhT5k6Lr1xeSDtmPEtRgty4E` with `migrate` (T20, 2026-11-09) | Success | [2YqW63d7...](https://testnet.nearblocks.io/txns/2YqW63d7dzJRrjJbUcLsCVVp1te94FRppb41VPCEP7hk) |
| FunctionCall      | owner    | `set_skin_caps` with 2,200, 1,300, 1,100, 50 (T20)                                                 | Success | [482XR2K7...](https://testnet.nearblocks.io/txns/482XR2K7Df2je6zNZ73yKE7FdyPvyj1VRx2uN2oPb3qQ) |

## Refusals

| Method           | Signer        | What the contract answered                            | Status  | Transaction                                                                                    |
| ---------------- | ------------- | ----------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `allocate_stats` | `p-pilot92k9` | `Smart contract panicked: insufficient volts`         | Failure | [FevPLu3e...](https://testnet.nearblocks.io/txns/FevPLu3e5fMKhHoCkqbQ53am3XA1DjFQgHRzZVJHa8su) |
| `bind`           | `p-t70728c1`  | `Smart contract panicked: bound item` (a second bind) | Failure | [8HEfBDbr...](https://testnet.nearblocks.io/txns/8HEfBDbrHwDRDYj3puhBag4HerSnCnEU2jGjnkhPrEq9) |

## State on 2026-11-05

Read with `call_function` views and `view_access_key_list` at final finality:

- `view_account` of the game account: `code_hash` `2ctpTSVNWEnpRFYuxcNjGSMhKL1YhwhsJ9TQrCmHL93D`.
- Access keys of the game account: one full-access key, and one function-call key for `commit_batch`, `settle_batch`, `abort_batch` on itself.
- Access keys of the owner account: one full-access key, and one function-call key for the 8 owner methods on the game contract.
- Access keys of `vortex` and of `p-pilotiilc`: one full-access key (the sealed admin key), and one function-call key for the 9 player methods on the game contract.
- `get_team` for `vortex`: `per_tx` 5000, `per_day` 15000. `get_player` reports `is_team: true` for all four teams.
- `nft_supply_for_owner` of the game account: 20 (the bots).
- `get_batch(9966119)`: `settled: true`, `settled_count: 9`, `aborted: false`, `matchups: []`.
- `get_drone("d:50")`: ELO 984, 0 wins, 1 loss, stats `[4,4,3,3,3,3,3,3,3]`, `equipped_mod` `m:45`.
- `get_catalog`: 32 skin templates and 26 mod templates.
- `ft_metadata`: name `Volts`, symbol `VOLT`, decimals 0. `nft_metadata`: name `Hyperdrome`, symbol `HDROME`, spec `nft-1.0.0`.
