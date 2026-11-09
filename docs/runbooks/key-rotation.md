# Key rotation

What can be rotated, how, and what cannot. Testnet only. No key material belongs in this file, in a commit or in a terminal log: commands below read public keys, never private ones.

| Key                                              | Where it is held                                                                                            | How it is replaced                                               |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Play key of a player or team account             | Sealed in `users.play_key_enc` under `KEY_ENCRYPTION_KEY`                                                   | `rotatePlayKey`, one transaction (below)                         |
| Admin key of a player or team account            | Sealed in `users.admin_key_enc` under `ADMIN_KEY_ENCRYPTION_KEY`                                            | No code replaces it                                              |
| Settlement key on `game.hyperdrome.testnet`      | `NEAR_SETTLEMENT_KEY` in the app's env; `~/.near-credentials/testnet/hyperdrome.testnet-settlement.json`    | near-cli-rs `add-key` and `delete-keys` on the account (below)   |
| Ops key on `hyperdrome.testnet`                  | `NEAR_OPS_KEY` in the app's env; `~/.near-credentials/testnet/hyperdrome.testnet-ops.json`                  | near-cli-rs `add-key` and `delete-keys` on the account (below)   |
| Full-access keys of the two root accounts        | The near-cli-rs legacy keychain on the operator's machine ([dev-setup.md](dev-setup.md), "Where keys live") | No rotation is recorded and this file has no procedure for it    |
| `KEY_ENCRYPTION_KEY`, `ADMIN_KEY_ENCRYPTION_KEY` | The app's env                                                                                               | Cannot be replaced without re-sealing; no code does that (below) |

The method lists and allowances of the function-call keys are in [SPEC.md](../../SPEC.md) 4.1.

## Play key of a player or team

`rotatePlayKey(accountId, adminKeyEnc, { keyVersion, allowance })` in [lib/near/adapter.js](../../lib/near/adapter.js); the transaction's actions are built by `playKeyRotation` in [lib/near/play-key.js](../../lib/near/play-key.js). It is the one place where application code opens a full-access key ([DECISIONS.md](../../DECISIONS.md) 2.22).

What the call does:

1. Opens the account's admin key from `adminKeyEnc` with `ADMIN_KEY_ENCRYPTION_KEY` (the account id is the associated data).
2. Reads the account's access keys and generates a new ed25519 keypair locally.
3. Sends one transaction, signed by the admin key, from the account to itself: a DeleteKey for every function-call key whose receiver is the game contract, then an AddKey for the new key with the 9 play methods and the allowance (1 NEAR unless `allowance` is given).
4. Returns `{ playKeyEnc, keyVersion, txHash }`: the new key sealed under `KEY_ENCRYPTION_KEY`, and `keyVersion` plus 1. The caller writes `users.play_key_enc` and `users.key_version`.

If the transaction's outcome is unknown the call throws `RpcUnknownOutcomeError` with the sealed new key attached as `pending`. Calling it again is safe: it deletes whichever play key is on the account and adds a new one.

Callers: [services/team-seed.service.js](../../services/team-seed.service.js) only, which gives each new AI team a play key with a 2 NEAR allowance ([seed-teams.md](seed-teams.md)). The four teams' keys were rotated to a 7 NEAR allowance on 2026-11-09 by a one-off script through `lib/near` (HANDOFF.md, T15c), and each account holds about 7 NEAR. No route, script or admin command rotates a player's key; doing it for one player takes a one-off script that calls `rotatePlayKey` through `lib/near` and writes the two columns.

Record and tests:

- Testnet, `vortex.game.hyperdrome.testnet`, 2026-11-05: https://testnet.nearblocks.io/txns/asbxnwFq5ow79gSmfSYNdR5tg7M4a648uCGVFYsywyU ([HANDOFF.md](../../HANDOFF.md), T12 part 1).
- [tests/near/adapter-keys.test.js](../../tests/near/adapter-keys.test.js) decodes the signed transaction against a fake RPC (runs in CI); [tests/near/testnet.integration.test.js](../../tests/near/testnet.integration.test.js) rotates a key on testnet when `NEAR_TESTNET_INTEGRATION=1` (not in CI).

Check afterwards (expect one full-access key and one function-call key):

```sh
near account list-keys <account> network-config testnet now
```

## Settlement key and ops key

Both are function-call keys. A function-call key's method list and allowance cannot be edited in place, so a change is always one key added and one deleted. Both actions are signed by the account's full-access key from the legacy keychain; the application never loads that key.

| Key        | Account                   | Methods                                                                                                                      | Allowance | Env name              |
| ---------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------- |
| Settlement | `game.hyperdrome.testnet` | `commit_batch,settle_batch,abort_batch`                                                                                      | 30 NEAR   | `NEAR_SETTLEMENT_KEY` |
| Ops        | `hyperdrome.testnet`      | `create_player,register_player,mint_drone,mint_item,mint_volts,set_team_budget,set_paused,set_base_uri,link_wallet,withdraw` | 10 NEAR   | `NEAR_OPS_KEY`        |

Both keys call `game.hyperdrome.testnet`.

### Same keypair, new method list or a fresh allowance

Recorded on 2026-11-04 (T6b, when `abort_batch` joined the settlement key): the key was deleted and the same public key added back, so `NEAR_SETTLEMENT_KEY` did not change. Commands and the two transaction links: [dev-setup.md](dev-setup.md), "Rotate the settlement key's method list". The same public key cannot be on an account twice, so this order is delete, then add, and the app cannot sign with the key between the two transactions; run it with the scheduler off.

### New keypair

Use this when a key may have leaked. With a new public key the order is add, then delete, so the app has a working key throughout. These steps use the commands of the T6b record with a new public key; this order has not been run in this project.

1. Generate the new keypair on the operator's machine, in its own file under `~/.near-credentials/testnet/` with mode 600, and print only its public key ([dev-setup.md](dev-setup.md), last paragraph of "Owner calls with the ops key"). The repository records the files T2 and T3 created, not the command that generated them. near-cli-rs 0.30.1 can generate the pair inside `add-key` (`autogenerate-new-keypair save-to-legacy-keychain` in place of `use-manually-provided-public-key`); it then saves the file under `~/.near-credentials/testnet/<account>/`, beside the full-access keys.
2. Add the new key (settlement shown; for ops, the account is `hyperdrome.testnet`, the allowance `10 NEAR` and the ops method list):

   ```sh
   near account add-key game.hyperdrome.testnet grant-function-call-access --allowance '30 NEAR' \
     --contract-account-id game.hyperdrome.testnet --function-names 'commit_batch,settle_batch,abort_batch' \
     use-manually-provided-public-key "$NEW_PK" network-config testnet sign-with-legacy-keychain send
   ```

3. Put the new private key in the app's env under the key's env name ([dev-setup.md](dev-setup.md), "Export a key for the app's env") and restart or redeploy the app: the adapter reads its config once, when it is first used ([lib/near/index.js](../../lib/near/index.js)).
4. Delete the old key:

   ```sh
   near account delete-keys game.hyperdrome.testnet public-keys "$OLD_PK" network-config testnet sign-with-legacy-keychain send
   ```

5. Check: `near account list-keys <account> network-config testnet now` shows the new key with its methods. Then use the key once. Settlement key: the next tick commits or settles a batch ([deploy.md](deploy.md), "By hand"). Ops key: a Play Demo sign-in reaches the dashboard (the bootstrap sends `create_player` and the mints with it), or one owner call from [dev-setup.md](dev-setup.md), "Owner calls with the ops key", signed with the new key file. `GET /api/health` uses neither key.

## What cannot be rotated without re-sealing

Sealing is AES-256-GCM in [lib/near/keys.js](../../lib/near/keys.js). A sealed blob is `base64(version byte ++ IV ++ tag ++ ciphertext)`; the version byte names the blob format, not the key, and `openSecret` takes one key. A blob sealed under an old value of an encryption key therefore fails to open under a new value.

| Env name                   | What is sealed under it                                                                                                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KEY_ENCRYPTION_KEY`       | Every play key (`users.play_key_enc`, and `playKeyEnc` in `users.bootstrap_pending` for a `create_player` whose outcome is unknown), the seed of every batch not yet settled (`batches.seed_enc`), the secret of every pack open (`pack_opens.secret_enc`) |
| `ADMIN_KEY_ENCRYPTION_KEY` | Every admin key (`users.admin_key_enc`, and `adminKeyEnc` in `users.bootstrap_pending`)                                                                                                                                                                    |

- No script re-seals these columns and no code reads two values of a key. `users.key_version` counts play key rotations; it does not name an encryption key.
- Replacing either value needs every blob under it opened with the old value and sealed again with the new one before the app runs with the new value. That code does not exist in this repository.
- What follows from the code if `KEY_ENCRYPTION_KEY` is changed without a re-seal (not run as a procedure): player and team actions fail until each account's play key is replaced, which `rotatePlayKey` can do because it opens only the admin key and seals the new play key under the current `KEY_ENCRYPTION_KEY`; a committed batch cannot be settled because its seed cannot be opened: `settleBatch` in [services/settle.service.js](../../services/settle.service.js) throws before it sends `settle_batch`, no attempt is counted, so the automatic abort of [deploy.md](deploy.md), "When a batch cannot settle", does not run and the batch's drones stay locked until `abort_batch`, which needs no seed, is called for it with the settlement key (no runbook has a command for that call); a pack open that stopped between commit and reveal cannot be revealed.
- If `ADMIN_KEY_ENCRYPTION_KEY` is changed without a re-seal, no existing account's play key can be rotated; the play keys already on the accounts keep working.

Not covered here: `AUTH_SECRET`, `CRON_SECRET` and `AUTH_GOOGLE_SECRET`.
