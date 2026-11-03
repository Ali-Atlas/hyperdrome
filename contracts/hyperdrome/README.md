# Hyperdrome contract

The one NEAR contract behind Hyperdrome: Volts (NEP-141), drones, skins and mods (NEP-171/177/178/181), player and team accounts, marketplace, packs and race settlement. Deployed on testnet at `game.hyperdrome.testnet`.

- Behavior, state, methods, events and errors: SPEC.md section 4 at the repository root.
- Build, test and deploy commands, keys and accounts: `docs/runbooks/dev-setup.md`.

| Path                                    | Contents                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `src/lib.rs`                            | Contract, versioned state, `new`, `migrate`                                   |
| `src/types.rs`                          | On-chain records                                                              |
| `src/constants/`                        | Every settlement constant (SPEC.md 2 and 4.6)                                 |
| `src/math.rs`                           | Stat budget, caps, costs, mod effects, fixed-point ELO                        |
| `src/owner.rs`                          | Owner methods, `create_player`                                                |
| `src/player.rs`                         | Player methods (`bind` now; the rest in T5)                                   |
| `src/settlement.rs`                     | `commit_batch`, `settle_batch` (T6)                                           |
| `src/nft.rs`, `src/ft.rs`               | Token standards; hand-written NFT transfers keep bound items with their drone |
| `src/views.rs`, `src/constants_view.rs` | Views                                                                         |
| `src/events.rs`                         | `hyperdrome` NEP-297 events                                                   |
| `src/unit_tests/`                       | Unit tests                                                                    |
| `tests/`                                | near-sandbox tests                                                            |
