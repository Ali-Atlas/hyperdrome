# SPEC.md

Hyperdrome on NEAR. Source of truth for behavior, data, interfaces and constants. If code and this file disagree, this file is wrong or the code is; fix one in the same PR. Numbers here come from the baseline game (tag `pre-hackathon`) unless a row says "new".

## 0. Reading guide

Sections: 1 product and loop, 2 constants, 3 architecture, 4 contract, 5 engine, 6 server and chain adapter, 7 data model, 8 API routes, 9 real-time, 10 AI teams, 11 pages, 12 auth and onboarding, 13 tests and gas budgets, 14 threat model, 15 versions and environment, 16 out of scope.

## 1. Product and loop

Idle drone-racing strategy game. Every 3 minutes, every active drone is paired by level bracket and ELO and raced 1v1 by a deterministic simulator. A race is announced 3 minutes before it runs; the first 2 minutes are the strategy window (swap the equipped mod and skin, allocate stats), the last minute is locked. Winners earn Volts and XP, losers earn less of both. Volts buy stat upgrades, packs, capsules, vendor drones and marketplace items. Drones, skins and mods are on-chain tokens; a drone carries every item bound to it through a sale. AI racing teams own accounts, drones and Volts and play the same loop.

Loop: sign in (Google or email) -> account and starter kit created on-chain -> allocate 20 stat points -> drone is active -> matchup appears -> swap loadout -> race settles on-chain -> Volts and XP arrive -> repeat.

## 2. Constants

All constants that affect settlement live in the contract (`constants.rs`). The app reads them through `get_constants()` and never redefines them.

### 2.1 Drones

| Name                               | Value                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Stats (9, each 1-100)              | speed, turning, acceleration, durability, night_vision, battery_capacity, rain_handling, wind_resistance, consistency                           |
| Total stat budget                  | TSB(L) = 9 + 20 * L                                                                                                                             |
| Per-stat cap                       | cap(L) = min(100, 10 + floor(4.5 * L))                                                                                                          |
| Upgrade cost X -> X+1              | 1 + floor(X / 10) Volts, paid from the owner's Volts                                                                                            |
| Respec                             | none; stats never decrease                                                                                                                      |
| Level cap                          | 20                                                                                                                                              |
| XP to next level                   | 200 * L * L                                                                                                                                     |
| XP per race                        | winner 10, loser 4                                                                                                                              |
| Level-up                           | +20 TSB; +20 Volts minted to the owner (none for contract-owned bots)                                                                           |
| Starting ELO                       | 1000; K = 32                                                                                                                                    |
| Tier (art)                         | L1-5 tier 1, 6-10 tier 2, 11-15 tier 3, 16-20 tier 4                                                                                            |
| Starter drone                      | all stats 1, L1, active                                                                                                                         |
| Vendor drone                       | 3,500 Volts; L1; each stat rolled 1-5 then trimmed to TSB; plus 1 common skin and 1 common mod bound, not equipped                              |
| Milestone drones (new owner slots) | free L1 drone at 1,000 lifetime player races if the player owns fewer than 2 drones, and at 3,000 if fewer than 3; stats random walk within cap |

### 2.2 Players

| Name                                      | Value                                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| Starter kit                               | 1 starter drone, 1 Ember common skin, 1 random common mod, 1,000 Volts                   |
| Active slots                              | 1; slot 2 at 500 lifetime player races; slot 3 at 2,000; max 3                           |
| Post-race skin drop (winner, humans only) | legendary 0.1%, epic 0.5%, rare 2%, common 5% per win; from catalog supply, else nothing |

### 2.3 Races

| Name                  | Value                                                                                                                                                                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cadence               | 180 s; batch slot = floor(unix_seconds / 180)                                                                                                                                                                                                                                                               |
| Strategy window       | 120 s after commit; locked from 120 s to settlement                                                                                                                                                                                                                                                         |
| Brackets              | L1-5, 6-10, 11-15, 16-20, 20+                                                                                                                                                                                                                                                                               |
| Pairing               | within bracket, ELO descending, greedy nearest; same human owner never paired; a drone left without a partner is paired with any remaining same-bracket drone of another owner, else sits out                                                                                                               |
| Bots                  | contract-owned drones fill each non-empty bracket to max(count, 5) rounded up to even                                                                                                                                                                                                                       |
| Laps                  | 3                                                                                                                                                                                                                                                                                                           |
| Weather (uniform)     | clear, clouds, rain, heavy_rain, wind, haze, fog                                                                                                                                                                                                                                                            |
| Time of day (uniform) | dawn, day, dusk, night                                                                                                                                                                                                                                                                                      |
| Winner payout         | 3 + floor(L_winner / 2) + floor(difficulty / 2) + max(0, floor((ELO_loser - ELO_winner) / 100)) + dominance; dominance = 5 if margin > 40%, 2 if margin > 20%, else 0; margin = abs(t_a - t_b) * 100 / min(t_a, t_b), compared exactly (abs(t_a - t_b) * 100 > 40 * min(t_a, t_b)) on the millisecond times |
| Loser payout          | 1 + floor(L_loser / 4)                                                                                                                                                                                                                                                                                      |
| ELO                   | expected_w = 1 / (1 + 10^((ELO_l - ELO_w) / 400)); new_w = round(ELO_w + 32 * (1 - expected_w)); new_l = round(ELO_l - 32 * expected_w); contract uses the fixed-point table in 4.6                                                                                                                         |
| Bot payouts           | not minted (owner is the contract)                                                                                                                                                                                                                                                                          |

### 2.4 Engine

| Name                             | Value                                                                                                                                                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Segment stretches                | straights and turns split into runs of 2-4 (sizes random), runs alternate from a random start type, reshuffled every lap                                                                                                                      |
| Subtypes (straight)              | short_burst 0.60 (accel .5, speed .3, wind .2); standard_str 1.00 (speed .5, accel .3, wind .2); long_straight 1.40 (speed .6, accel .2, wind .2)                                                                                             |
| Subtypes (turn)                  | gentle_curve 0.70 (turning .4, accel .3, durability .3); standard_turn 1.00 (turning .5, durability .3, accel .2); sharp_hairpin 1.30 (turning .6, durability .3, accel .1); chicane 0.90 (accel .4, turning .4, durability .2)               |
| Subtype pick                     | uniform within type; per-segment jitter on the multiplier: 1 + (r - 0.5) * 0.06                                                                                                                                                               |
| Base time                        | straight 1.0 + 0.20 * difficulty; turn 1.8 + 0.40 * difficulty; times the subtype multiplier                                                                                                                                                  |
| Segment time                     | clamp(base - 0.007 * score, 0.8, 8.0) seconds                                                                                                                                                                                                 |
| Condition multipliers on score   | night: clamp(nv/50, .5, 1.5); rain: clamp(rh/50, .5, 1.5); heavy_rain: clamp(rh/60, .4, 1.4); wind: clamp(wr/50, .5, 1.5); fog: clamp(nv/60, .6, 1.4); haze: clamp(nv/70, .7, 1.3); others 1                                                  |
| Battery fade                     | score *= 1 - 0.85 * (lap/3)^3 * (1 - battery/100) * length_mult; length_mult short 0.8, medium 1.0, long 1.2                                                                                                                                  |
| Score floor                      | 0.1                                                                                                                                                                                                                                           |
| Time noise per drone per segment | (r - 0.5) * 2 * (0.03 straight, 0.06 turn) * (1 - consistency/100), then clamp to [0.8, 8.0]                                                                                                                                                  |
| Winner                           | lower total time; exact tie: r < 0.5 picks drone A                                                                                                                                                                                            |
| Mod effect (new)                 | effective_stat = clamp(round(stat * (100 + pct) / 100), 1, 100) for the bonus stat and (100 - pct) for the penalty stat, applied before scoring                                                                                               |
| Legendary specials (new)         | Phantom Drive: battery fade is 0 on lap 1. Quantum Sync: on turn segments the noise factor uses (1 - 2 * consistency/100) clamped at 0. Storm Rider: every condition multiplier m below 1 becomes 1 - (1 - m) / 2. Penalty stats still apply. |

### 2.5 Mods (26 templates; bonus +pct / penalty -pct)

Common (+2/-1): Streamline Plate speed/turning; Grip Pads turning/speed; Quick Charge battery/durability; Shock Absorber durability/acceleration; Steady Module consistency/speed; Night Lens night_vision/rain_handling; Rain Shield rain_handling/wind_resistance; Wind Fin wind_resistance/night_vision; Light Frame acceleration/durability; Tracker Coil turning/battery.
Rare (+4/-2): Aero Shell speed/turning; Grip Coating turning/acceleration; Storm Plating rain_handling/speed; Night Optics night_vision/battery; Turbo Intake acceleration/consistency; Endurance Core battery/speed; Aileron Kit wind_resistance/acceleration; Stabilizer Brace consistency/speed.
Epic: Plasma Core +6 acceleration / -4 consistency; Stealth Aero +6 speed / -4 durability; Typhoon Module +8 rain_handling / -5 speed; Predator Lens +8 night_vision / -5 battery; Iron Hull +7 durability / -4 turning.
Legendary (special / penalty): Phantom Drive / -5 wind_resistance; Quantum Sync / -4 speed; Storm Rider / -6 acceleration.
Supply: unlimited instances. A mod is one token; it is bound to at most one drone, permanently.

### 2.6 Skins (catalog, image-backed, `public/skins/<rarity>/<slug>.webp`)

Common (8): bone, cobalt, dusk, ember, frost, rust, shadow, venom. Rare (8): anodized_blaze, arctic_fury, chrome_fury, copper_king, gunmetal_storm, jade_circuit, midnight_oil, titanium_ghost. Epic (8): crystal_phantom, dragon_scale, frozen_abyss, iridescent_wraith, liquid_mercury, obsidian_core, solar_flare, void_bloom. Legendary (8): apex_predator, celestial, diamond_hands (file diamond_hand.webp), gilded_throne, kraken, necromancer, samurai, valiant.
Supply caps per template (new, tunable): common 10, rare 6, epic 4, legendary 3. When a rarity has no supply left, packs mint a placeholder skin of that rarity (name from the placeholder pools in the baseline `services/pack.service.js`, carried into the contract's `constants/names.rs`; image `/placeholder/`), unlimited. A placeholder is stored with template 0, its rarity and its name, and never counts against supply.
Equip rule: legendary skins equip on any tier; other skins equip only where a tier render exists: ember tier 1; chrome_fury, crystal_phantom, dragon_scale, frozen_abyss, obsidian_core tier 4. (Carried from baseline; tier renders are the content gap.)
Cosmetic only. Bound to at most one drone, permanently.

### 2.7 Packs and capsules

| Tier      | Skin pack | Mod capsule | Slot 1                  | Slots 2 and 3 (each)                            |
| --------- | --------- | ----------- | ----------------------- | ----------------------------------------------- |
| starter   | 2,000     | 1,000       | common                  | common 80%, rare 17%, epic 2.5%, legendary 0.5% |
| premium   | 12,000    | 6,000       | rare                    | common 40%, rare 35%, epic 20%, legendary 5%    |
| legendary | 60,000    | 30,000      | legendary 45%, epic 55% | rare 55%, epic 40%, legendary 5%                |

Rarity roll: r in [0,1) from the reveal hash, cumulative in the order listed.

### 2.8 Marketplace

Items: drones, skins, mods. Rake 10% to treasury, 90% to seller. Minimum price 10 Volts. A listed drone keeps racing. Bound items cannot be listed alone and move with the drone.

### 2.9 Tracks (id, name, levels, difficulty, straights/turns, length)

0 Horizon Express 1-5 d1 2/2 short; 1 Neon Straightaway 1-5 d2 3/3 medium; 2 Keyhole 1-5 d2 2/2 short; 3 The Grid 1-5 d3 4/4 medium; 4 Meridian 6-10 d3 4/4 medium; 5 Circuit Alpha 6-10 d4 4/5 medium; 6 Crossfire 6-10 d4 3/5 medium; 7 Iron Ribbon 6-10 d5 4/6 long; 8 Skyline Drift 11-15 d6 3/7 long; 9 Helix 11-15 d6 2/6 medium; 10 Switchblade 11-15 d7 3/8 long; 11 Phantom Circuit 11-15 d7 4/7 long; 12 Voltage Loop 16-20 d8 4/8 long; 13 Obsidian Maze 16-20 d9 3/9 long; 14 Apex Descent 16-20 d9 2/10 long; 15 Tempest Run 16-20 d10 2/8 long. 20+ uses the 16-20 set. Art exists for 0, 1, 2, 3, 4, 5, 8, 12, 15; the rest use `TrackPlaceholder`.

### 2.10 AI teams (new)

4 teams. Per team: 3 drones (levels 4, 5, 8), 2 bound skins and 3 bound mods spread across them, 20,000 Volts. Caps: per transaction 5,000 Volts, per day 15,000 Volts, enforced on-chain on every Volt debit of a team account (`allocate_stats`, `buy`, `open_pack`, `vendor_buy_drone`); the day is `block_timestamp_ms / 86_400_000`; a team with no budget row has zero caps; regular players are never cap-checked. Reserve floor 5,000 Volts (the team never spends below it).

## 3. Architecture

Components: Next.js 16 app on Vercel (pages, API routes, scheduler endpoint hit by Vercel cron every 3 minutes, AI-team runner inside the same tick); Neon Postgres (profiles, sessions, matchmaking inputs, caches of on-chain state, race logs); Pusher Channels (push to browsers); one NEAR contract `game.hyperdrome.testnet` (assets, Volts, economy rules, settlement, player account creation); NEAR testnet RPC (FastNear primary, Lava failover).

Source of truth: ownership, balances, stats, level, XP, ELO, bound and equipped items, listings, batches, team budgets -> contract. Profiles, sessions, active flags, slots, matchmaking, race logs and snapshots, team personas -> database. The database caches on-chain fields and is refreshed from transaction outcomes and events; a nightly or on-demand `reconcile` view-read repairs drift.

Race cycle (one tick, slot S): (0) AI teams act on open matchups and economy rules; (1) settle batch S-1: read frozen on-chain state, simulate, `settle_batch`, update caches, push results; (2) matchmaking from active drones, `commit_batch(S, hash(seed), matchups)`, store seed encrypted, push matchups. The tick is guarded by a unique `cron_ticks(slot)` row.

Trust boundaries: browser to server (session cookie, Zod, ownership); server to chain (per-player scoped keys, ops key, settlement key); server to AI teams (team scoped keys, on-chain caps); owner to contract (owner methods, upgrade key kept offline).

## 4. Contract

Account `game.hyperdrome.testnet`, Rust, near-sdk 5.29.1, one crate at `contracts/hyperdrome`.

### 4.1 Accounts and keys

| Account                          | Keys                                                                                                                                                                                                                 | Purpose                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| hyperdrome.testnet               | full-access (offline, deploys and admin); ops function-call key -> game contract, methods `create_player,register_player,mint_drone,mint_item,mint_volts,set_team_budget,set_paused,set_base_uri`, allowance 10 NEAR | owner, treasury                       |
| game.hyperdrome.testnet          | full-access (deploys only, offline); settlement function-call key -> itself, methods `commit_batch,settle_batch`, allowance 5 NEAR                                                                                   | contract, parent of players and teams |
| p-<slug>.game.hyperdrome.testnet | admin full-access (server-held, encrypted, rotation only); play function-call key -> game contract, methods `allocate_stats,equip,bind,list,buy,cancel,open_pack,reveal_pack,vendor_buy_drone`, allowance 1 NEAR     | player                                |
| <name>.game.hyperdrome.testnet   | same as player                                                                                                                                                                                                       | AI team                               |

Player and team accounts are created by the contract (`create_player`) with 0.05 NEAR. Function-call keys cannot attach deposits, so no player method takes a deposit. `ft_transfer`, `nft_transfer`, `storage_*` require 1 yocto and are therefore unreachable from play keys.

### 4.2 State

```
enum VersionedState { V1(StateV1) }
StateV1 {
  owner_id, treasury_id: AccountId, paused: bool,
  volts: FungibleToken, volts_meta: LazyOption<FungibleTokenMetadata>,
  nft: NonFungibleToken, nft_meta: LazyOption<NFTContractMetadata>,
  players: LookupMap<AccountId, VersionedPlayer>,
  drones_hot: LookupMap<TokenId, VersionedDroneHot>,
  drones_cold: LookupMap<TokenId, VersionedDroneCold>,
  items: LookupMap<TokenId, VersionedItem>,
  listings: LookupMap<TokenId, Listing>,
  active_listings: IterableSet<TokenId>,   // active listing ids, for get_listings paging
  batches: LookupMap<u64, VersionedBatch>,
  packs: LookupMap<u64, PackCommit>,
  teams: LookupMap<AccountId, TeamBudget>,
  skin_minted: LookupMap<u16, u32>,          // template id -> minted count
  next_drone: u64, next_skin: u64, next_mod: u64, next_pack: u64,
}
Player { seq: u64, created_at_ms: u64, is_team: bool }
DroneHot { level: u8, xp: u32, elo: i32, wins: u32, losses: u32, equipped_mod: Option<TokenId>, equipped_skin: Option<TokenId>, in_batch: Option<u64> }
DroneCold { stats: [u8; 9], bound_skins: Vec<TokenId>, bound_mods: Vec<TokenId>, invested: u64, name: String }
Item { kind: Skin|Mod, template: u16, rarity: u8, bound_to: Option<TokenId>, placeholder_name: Option<String> }
Listing { seller: AccountId, price: u128, listed_at_ms: u64 }
Batch { seed_hash: [u8;32], committed_at_ms: u64, matchups: Vec<Matchup>, settled: bool, settle_tx_count: u32 }
Matchup { a: TokenId, b: TokenId, track: u8, weather: u8, tod: u8 }
PackCommit { buyer: AccountId, kind: Skin|Mod, tier: u8, hash: [u8;32], height: u64, revealed: bool }
TeamBudget { per_tx: u128, per_day: u128, spent: u128, day: u32 }
```

Token ids: drones `d:<n>`, skins `s:<n>`, mods `m:<n>`, with n starting at 1. Template ids are 1-based in the 2.5 and 2.6 listing order: mods 1-26; skins 1-32 (common 1-8, rare 9-16, epic 17-24, legendary 25-32). 0 means "none" in `stats_hash` and snapshots, and is the stored template of a placeholder skin, so an equipped placeholder hashes as an empty skin slot. Rarity ids: common 0, rare 1, epic 2, legendary 3. Bots are drones owned by the contract account. Stats order is the 9 stats in 2.1 order.

### 4.3 Standards

NEP-141 Volts: name "Volts", symbol "VOLT", decimals 0, icon none. `ft_transfer` standard (1 yocto). Storage registration is done by the contract for every player in `register_player` (contract pays).
NEP-171/177/178/181 via `NonFungibleToken`. `nft_transfer` and `nft_transfer_call` by hand: panic "bound item" if the token is a skin or mod with `bound_to`; if the token is a drone, transfer it, then `internal_transfer_unguarded` every bound skin and mod, clear approvals on all, emit one `NftTransfer` listing every moved token; panic "listed" if the token is listed; panic "locked" if `in_batch` is set and the batch is locked. `nft_token` returns metadata with `extra` = JSON summary (level, elo, tier, equipped). NFT collection metadata: spec `nft-1.0.0`, name "Hyperdrome", symbol "HDROME". `nft_metadata.base_uri` = the app's `/api/metadata`, set by the owner with `set_base_uri` (null until the app URL exists). Token `media` = `<base_uri>/<token_id>/image`, null while `base_uri` is null.

### 4.4 Methods

Owner (predecessor == owner_id):

- `create_player(slug: String, admin_pk: PublicKey, play_pk: PublicKey, is_team: bool) -> Promise`: creates `p-<slug>.<current>` (or `<slug>.<current>` when is_team) with CreateAccount, Transfer 0.05 NEAR, AddKey full-access admin_pk, AddKey function-call play_pk (receiver current, methods per 4.1, allowance 1 NEAR); then registers the player in a callback that returns true when the account was created. Panics "bad slug" if slug is not `[a-z0-9]{3,20}`, "exists" if the player is already registered.
- `register_player(account_id)`: FT storage registration and Player row; idempotent.
- `mint_drone(owner, name, level: u8, stats: [u8;9], active_hint: bool) -> TokenId`: validates level in 1-20 ("bad level"), each stat >= 1 ("bad stat") and <= cap(level) ("over cap"), sum <= TSB(level) ("tsb exceeded"); elo 1000; emits NftMint and `drone_minted`. `active_hint` is not stored (active flags live in the database).
- `mint_item(owner, kind, template: u16, placeholder_name: Option<String>) -> TokenId`: enforces skin supply caps unless placeholder ("no supply"); a placeholder skin takes its rarity from `template` and is stored with template 0; "bad template" for an unknown template or a placeholder name on a mod; emits NftMint and `item_minted`.
- `mint_volts(to, amount)`: emits FtMint.
- `set_team_budget(account, per_tx, per_day)`; `set_paused(bool)`; `set_base_uri(base_uri: Option<String>)` sets `nft_metadata.base_uri`.

Player (predecessor is a registered player, else "not player"; every method takes `seq: u64` which must equal `player.seq + 1`, then stores it; panics "bad seq" otherwise; panics "paused" when paused). Every Volt debit goes through one spend path: balance check ("insufficient volts"), then the team cap check if the caller is a team (2.10, "cap exceeded"), then the burn or payment. Methods on a drone check, in order: exists ("not found"), not listed ("listed"), caller owns it ("not owner"), not locked ("locked").

- `allocate_stats(drone, stats: [u8;9], seq)`: owner check; drone not locked; no decrease ("stat decrease"); each <= cap ("over cap"); sum <= TSB ("tsb exceeded"); cost per 2.1 burned (FtBurn, none when 0); team cap check if the caller is a team; adds the cost to `invested`; emits `stats_allocated`.
- `equip(drone, item: Option<TokenId>, kind, seq)`: owner check; drone not locked; `None` clears the slot; an item must exist and be of `kind` ("not found"), be bound to this drone ("not owner") and, for skins, pass the tier rule 2.6 ("tier"); emits `equipped`.
- `bind(drone, item, seq)`: owner owns both; item unbound; not listed; sets both sides; auto-equips if the slot is empty, the drone is not locked and (for skins) the 2.6 tier rule allows it; emits `item_bound`, plus `equipped` when it auto-equips.
- `list(token, price, seq)`: price >= 10 ("low price"); token exists ("not found"); not already listed ("listed"); owner check; not bound (for items, "bound item"); token and a drone's bound items move to contract escrow (internal transfer to current account, one NftTransfer; drone keeps racing and keeps `in_batch`); emits `listed`.
- `buy(token, seq)`: listing active ("not listed"); buyer != seller ("self buy"); Volts >= price; team cap check if buyer is a team; internal transfers buyer -> seller price - fee and buyer -> treasury fee, fee = floor(price / 10) (two FtTransfer); transfer token (and bound items) to buyer (one NftTransfer); remove listing; emits `sold`.
- `cancel(token, seq)`: listing active ("not listed"); seller check ("not owner"); token (and bound items) returns (NftTransfer); emits `cancelled`.
- `open_pack(kind, tier, hash: [u8;32], seq) -> u64`: tier 0 starter, 1 premium, 2 legendary ("bad tier" otherwise); price per 2.7 burned (FtBurn); team cap check; stores PackCommit with current height; returns the pack id (from 1); emits `pack_committed`.
- `reveal_pack(pack_id, secret: [u8;32], seq)`: pack exists ("not found"); buyer check ("not owner"); not yet revealed ("bad reveal"); `env::block_height() > height` ("too early"); `sha256(secret) == hash` ("bad reveal"); result = sha256(secret ++ env::random_seed() ++ pack_id LE bytes). Byte map for slot i in 0..3, all little-endian: rarity roll r_i = u32 at bytes [4i, 4i+4) / 2^32; template pick = u32 at bytes [12+4i, 16+4i); placeholder name pick = u16 at bytes [24+2i, 26+2i). Rarity per 2.7: the first entry whose cumulative bp exceeds floor(r_i * 10,000). Template = candidates[pick mod len], candidates in template id order: the rarity's skins with supply left, or all mods of that rarity; with no skin left, a placeholder (template 0, name = pool[name pick mod pool len]). Mints the 3 items to the buyer (NftMint and `item_minted` each); marks revealed; emits `pack_opened` with the token ids.
- `vendor_buy_drone(seq) -> TokenId`: 3,500 Volts burned (FtBurn); team cap check if the caller is a team; seed = sha256(env::random_seed() ++ new token id UTF-8) (the chain seed is per block; the token id separates purchases in one block); a stream of u32 LE values, block k = sha256(seed ++ k as u32 LE), drawn in order: 9 stat rolls 1 + (u32 mod 5); while the sum exceeds TSB(1), one draw picks a stat above 1 (index = u32 mod count, in stat order) and lowers it by 1, at most sum - 29 steps; then skin pick, mod pick, placeholder name pick, name word, letter, digit. Name `WORD-<LETTER><DIGIT>` from the baseline `drone-names.js` word pool (not unique; the token id is the identity). One common skin (uniform among commons with supply left, else a common placeholder) and one common mod (uniform among commons), both minted, bound and not equipped. Emits `drone_minted`, `item_minted` twice and `item_bound` twice, with their NftMint events.

Settlement (predecessor == current account):

- `commit_batch(batch_id: u64, seed_hash: [u8;32], matchups: Vec<Matchup>)`: batch_id unused; every drone exists and is not in another unsettled batch; sets `in_batch` on each; stores committed_at_ms = block_timestamp_ms; emits `batch_committed`.
- `settle_batch(batch_id, seed: [u8;32], results: Vec<RaceResult>)`: `sha256(seed) == seed_hash`; not settled; `results.len() == matchups.len()` and same pairs in order; for each: winner is a or b; times > 0; `stats_hash` equals sha256 of the contract's current (stats, equipped_mod template or 0, equipped_skin or 0) for that drone, else panic "state drift"; payouts per 2.3 computed in-contract (minted to current token owners unless the owner is the contract); ELO per 4.6; XP and level-ups per 2.1; `in_batch` cleared; marks settled; emits one `batch_settled` event carrying all races (see 4.7). Attach 200 TGas; the server splits batches above 50 races into chunks of 50 with the same seed (settle_tx_count increments; results must be contiguous).

`RaceResult { a, b, winner, time_a_ms: u32, time_b_ms: u32, stats_hash_a: [u8;32], stats_hash_b: [u8;32] }`.

Lock rule: a drone is locked when `in_batch` is set and `block_timestamp_ms >= committed_at_ms + 120_000`.

### 4.5 Views

`get_constants()`, `get_player(account)`, `get_drone(token) -> {hot, cold, owner, listed, locked}`, `get_drones(tokens: Vec)`, `get_item(token)`, `get_items(tokens)`, `get_listing(token)`, `get_listings(from, limit)` (iterate via a `Vector<TokenId>` of active listings), `get_batch(id)`, `get_team(account)`, `get_catalog()` (skin templates with minted counts, mod templates), `stats_hash(token)` (same hash settle uses), plus all standard `ft_*` and `nft_*` views.

### 4.6 Fixed-point ELO

`expected(d)` with d = ELO_l - ELO_w clamped to [-800, 800]: table `POW10[k]` = round(10^(k/400) * 1e6) for k = 0..800 step 25 (33 entries); interpolate linearly between entries; expected_w = 1e6 * 1e6 / (1e6 + pow10(d)) for d >= 0, and 1e6 - expected(-d) for d < 0; deltas = round(32 * (1e6 - expected_w) / 1e6) and round(32 * expected_w / 1e6) negated for the loser. The app displays what the contract stores.

### 4.7 Events (NEP-297, standard `hyperdrome`, version `1.0.0`)

`drone_minted {token, owner, level}`, `item_minted {token, owner, kind, template, rarity}`, `stats_allocated {drone, stats, cost}`, `equipped {drone, kind, item}`, `item_bound {drone, item}`, `listed {token, seller, price}`, `sold {token, seller, buyer, price, fee}`, `cancelled {token}`, `pack_committed {pack_id, buyer, kind, tier}`, `pack_opened {pack_id, tokens}`, `batch_committed {batch_id, count}`, `batch_settled {batch_id, races: [{i, a, b, winner, ta, tb, va, vb, elo_a, elo_b, xp_a, xp_b, lvl_a, lvl_b, snap_a, snap_b}]}` where snap = `[stats 9 bytes as hex, mod template, skin template]`. One `batch_settled` per settle call. Standard nep141 and nep171 events on every mint, transfer and burn.

### 4.8 Errors

Panic messages are short lowercase strings and are the contract's API for failure paths: `paused`, `bad seq`, `not owner`, `not player`, `locked`, `bound item`, `listed`, `not listed`, `self buy`, `insufficient volts`, `over cap`, `cap exceeded`, `tsb exceeded`, `stat decrease`, `tier`, `bad slug`, `exists`, `state drift`, `bad reveal`, `too early`, `settled`, `not implemented`, `not found`, `same owner`, `bad level`, `bad stat`, `bad template`, `no supply`, `low price`, `bad tier`. `over cap` is the per-stat cap (2.1); `cap exceeded` is a team spend cap (2.10); `low price` is a listing under 10 Volts; `bad tier` is an unknown pack tier.

## 5. Engine (`lib/game-engine`, pure JS)

`simulateRace({ seed, raceId, droneA, droneB, track, weather, timeOfDay }) -> { winner: 'a'|'b', timeAms, timeBms, log }`. `seed` is the batch seed (hex), `raceId = "<batchId>:<index>"`; the race PRNG is xoshiro128** seeded with the first 16 bytes of sha256(seedBytes || utf8(raceId)), read as four little-endian u32 words (an all-zero state becomes 1, 2, 3, 4); `nextUnit()` = (next32() >>> 8) / 2^24. Draw order is exactly the baseline order: per lap, split straights (one draw per run except the last, which takes what is left), shuffle (Fisher-Yates), split turns, shuffle, start type; per segment: subtype pick, jitter, noise A, noise B; tie-break last, drawn only when the two millisecond totals are equal. `droneA/B` carry effective stats after mod application (`applyMod(stats, modTemplate)` in `lib/game-engine/mods.js`) and the special id; Phantom Drive and Storm Rider act in `scoreSegment`, Quantum Sync in the per-segment noise. `log` is client-safe: per segment `{lap, type, gapMs}` only, where `gapMs = Math.round((cumulative A - cumulative B) * 1000)` from the float sums (so the last `gapMs` can differ by 1 from `timeAms - timeBms`). Times are integers in milliseconds, computed from float seconds as `Math.round(t * 1000)` after the full sum so replay is byte-stable. `statsHash(stats9, modTemplateId, skinTemplateId)` in `lib/game-engine/stats-hash.js` mirrors the contract's `stats_hash` (sha256 of 9 stat bytes, u16 mod template LE, u16 skin template LE, 0 = none); `tests/golden/stats-hash.json` holds the shared test vectors. SHA-256 is a synchronous pure-JS implementation so replay runs the same in the browser. Mod templates live in `lib/game-engine/templates.js`, a mirror of the contract's `constants/catalog.rs` checked by a test.

## 6. Server and chain adapter (`lib/near`)

near-api-js 7.4.0, Node 22+. Nothing outside `lib/near` imports it (ESLint `hyperdrome/near-boundary`). Files: `config.js` (env, Zod), `provider.js`, `keys.js`, `events.js`, `errors.js`, `explorer.js`, `adapter.js` (real), `mock.js` (in-memory, same interface), `index.js` (`getNear()` returns the process singleton; `NEAR_ADAPTER=mock` selects the mock). Interface (JSDoc types in `index.js`); every call returns `{ txHash, result, events }`, `events` being the parsed `EVENT_JSON` logs in receipt order:

- `createPlayerAccount({ slug, isTeam }) -> { accountId, playKeyEnc, adminKeyEnc, keyVersion: 1, txHash }`: generates both ed25519 keypairs locally, calls `create_player` with the ops key (60 TGas), returns the keys sealed for storage. `AccountCreateError` if the callback returns false. On `RpcUnknownOutcomeError` the sealed keys are on `err.pending`, so the caller can store them before resolving.
- `callAsPlayer(accountId, playKeyEnc, method, args, { gas = 30 TGas })`: opens the play key, reads `get_player(account).seq` and sends `seq + 1` in the args (the caller never supplies seq).
- `callAsOps(method, args, { gas = 30 TGas })` (signed by `NEAR_OWNER_ID` with `NEAR_OPS_KEY`); `callAsSettlement(method, args, { gas = 200 TGas })` (signed by `NEAR_GAME_ID` with `NEAR_SETTLEMENT_KEY`).
- `view(method, args)` (optimistic finality; if every provider fails, one more failover round; contract panics are not retried); `getConstants()` cached per process.
- `nextSeq(accountId)`: the seq the next player call carries (`get_player(...).seq + 1`); panics `not player` when unregistered.
- `resolveOutcome(accountId, seq, txHash)`: after `RpcUnknownOutcomeError`, if the on-chain seq reached `seq`, fetches the transaction by hash and returns `{ applied: true, txHash, result, events }`; otherwise (or if that transaction failed with `bad seq`) `{ applied: false }`, so the caller may retry.
- `rotatePlayKey(accountId, adminKeyEnc, { keyVersion }) -> { playKeyEnc, keyVersion: keyVersion + 1, txHash }`: the only code path that opens an admin key; one transaction signed with it: DeleteKey for every function-call key scoped to the game contract, AddKey for a new play key (methods per 4.1, 1 NEAR allowance).
- `explorerTx(hash)` = `<explorer>/txns/<hash>`, `explorerAccount(id)` = `<explorer>/address/<id>`.
- `sealSecret(bytes, keyHex, aad)`, `openSecret(blob, keyHex, aad)`: AES-256-GCM, 12-byte IV, 16-byte tag, key = 64 hex chars; blob = base64(version byte 1 ++ IV ++ tag ++ ciphertext); AAD = the row it belongs to (the account id for keys). Play keys under `KEY_ENCRYPTION_KEY`, admin keys under `ADMIN_KEY_ENCRYPTION_KEY`; `key_version` on the row. Also used for batch seeds.
- Sending: transactions are built and signed in the adapter (hash known before sending), sent with `waitUntil: 'EXECUTED'` (the transaction's block is final and every non-refund receipt has executed), deposit always 0. After a send timeout, or an InvalidNonce (after a failover the second node usually rejects the same signed transaction because the first already executed it), the adapter looks the transaction up by hash (3 attempts) and returns that outcome; it raises `RpcUnknownOutcomeError` or `NonceError` only when the hash is unknown. Ops and settlement calls carry no seq, so this is what stops a rebuilt resend from applying twice.
- Errors (`errors.js`): `ContractPanicError` (`panic` = the 4.8 string, `method`, `txHash`), `KeyAllowanceError` (NotEnoughAllowance), `NonceError` (InvalidNonce; ops and settlement reset their nonce cache), `RpcUnknownOutcomeError` (`txHash`, `accountId`, `seq`), `AccountCreateError`, `TransactionFailedError` (a non-panic failure). Other errors propagate unchanged. Logging is `console.error({ scope: 'near', msg, ...fields })` only.
- RPC: near-api-js `FailoverRpcProvider` over `NEAR_RPC_URL` then `NEAR_RPC_FAILOVER_URL` (defaults in 15), each call raced against a 10 s timeout (near-api-js has none), 2 retries inside a provider. `NEAR_RPC_API_KEY`, when set, is sent as `Authorization: Bearer` to whichever URL is FastNear.
  Scheduler (`/api/races/run`, Vercel cron `*/3 * * * *`, CRON_SECRET): claim `cron_ticks(slot)`; phase 0 teams; phase 1 settle; phase 2 commit; each chain call idempotent by `batch_id`; on failure the batch stays in its state and the next tick retries.
  Matchmaking input: DB `drones.active` plus on-chain `in_batch == null`.
  Seed: 32 random bytes from `crypto.randomBytes`, stored AES-encrypted in `batches.seed_enc` until settled, then stored plain for replay.

## 7. Data model (Drizzle, changes to the baseline)

users: + `near_account_id` unique, `play_key_enc`, `admin_key_enc`, `key_version`, `is_team`, `team_persona`; `points` becomes a cache of `ft_balance_of`. drones, skins, mods: `token_id` text unique (replaces the integer MegaETH columns), on-chain fields (stats, level, xp, elo, wins, losses, equipped, bound) become caches with `chain_synced_at`. New: `batches(slot pk, seed_hash, seed_enc, seed, status committed|settled|failed, commit_tx, settle_txs json, committed_at, settled_at)`; `cron_ticks(slot pk, started_at)`; `actions(id uuid, user_id, method, seq, args json, tx_hash, status pending|applied|failed, created_at)`; `teams(user_id pk, name, persona json, reserve)`. races: + `batch_slot`, `race_index`, `seed`, `snapshot_a json`, `snapshot_b json`, `settle_tx`, `log json (client-safe)`. Removed: wallet_address, starter_volt_minted_at, starter_gas_sent_at, mint_tx_hash, minted_at, onchain_listing_id, list_tx_hash, pack_purchases, token_counters, epoch_id, settle_tx_hash.

## 8. API routes (all mutations: session required, Zod body, ownership check, `action_id` idempotency via `actions`, rate limit, Origin check)

Auth: Auth.js handlers; `POST /api/auth/bootstrap` (idempotent: creates the NEAR account and starter kit if missing). Drones: `GET /api/drones`, `GET /api/drones/[id]`, `POST /api/drones/[id]/allocate`, `/equip`, `/bind`, `/toggle` (DB only), `POST /api/drones/vendor`. Marketplace: `GET /api/marketplace`, `POST /api/marketplace/list`, `/buy`, `/cancel`, `POST /api/packs/open` (commit then reveal in one request: two chain calls, second after the next block), `GET /api/packs/[id]`. Races: `GET /api/races`, `GET /api/races/[id]` (with seed and snapshots once settled), `GET /api/races/next`, `GET /api/races/upcoming`, `GET /api/races/[id]/verify` (server replay, returns match true/false), `POST /api/races/run` (cron). Read: `GET /api/leaderboard`, `GET /api/users/[id]/profile` (no balances), `GET /api/tracks`, `GET /api/constants`, `GET /api/health`, `GET /api/metadata/[token]` and `/image`, `GET /api/stats` (live strip: next slot, last batch, volts minted and burned, trades today from cached events). Pusher: `POST /api/pusher/auth`.

## 9. Real-time (Pusher)

Channel `public`: `race:next {slot, startsAt, paused}`, `batch:committed {slot, count}`, `batch:settled {slot, txs, summary}`. Channel `private-user-<id>`: `race:matchup {race}`, `race:result {race}`, `user:balance {volts}`. Clients fall back to a 30 s poll of `/api/races/next` if Pusher is unavailable.

## 10. AI teams

Teams: `vortex` (Vortex Dynamics: speed and straights), `nimbus` (Nimbus Racing: rain and night), `hairpin` (Hairpin Collective: turning and durability), `static` (Static Union: consistency and battery). Each is a user row with `is_team`, a NEAR account, persona weights over the 9 stats, and caps per 2.10. Phase 0 each tick, per team: (a) for every drone with an open matchup, pick the bound mod with the best fit score = sum over the mod's bonus stat weight in the track's subtype mix (straights/turns ratio) plus condition relevance (rain/heavy_rain -> rain_handling, night/fog/haze -> night_vision, wind -> wind_resistance) minus penalty weight; equip if it differs; (b) on level-up, allocate all affordable points along persona weights; (c) if Volts - reserve >= capsule price and the team has fewer than 6 unbound mods, open a starter capsule (premium when Volts - reserve >= 20,000); (d) list the lowest-fit unbound mod at 1.2x the rarity base price (common 150, rare 800, epic 3,500, legendary 12,000); (e) buy a listed mod when its fit for some drone beats the current best by 2 or more and price <= 0.8x rarity base and within caps. Every action goes through `callAsPlayer` with the team's play key; on-chain caps are the hard limit.

## 11. Pages touched

Landing: live strip (next race countdown, last batch results ticker, volts minted and burned today, trades today, explorer link). Dashboard: matchup card for each active drone (opponent, track, weather, time, each side's edge computed from 2.4 weights, equipped mod with swap control, lock countdown). Drone detail: on-chain panel (token id, explorer link, owner), stats editor, bound items with equip controls, XP bar. Marketplace: split into `ListingGrid`, `ListingCard`, `SellModal`, `BuyModal`, `PackShop`, `CapsuleShop`; on-chain path only. Race detail: result, client-safe gap chart, settle tx link, "Verify" button replays in the browser from seed and snapshots and shows match. Leaderboard: team badge. Profile: fleet, record, recent races. Copy for Guide and FAQ updated where numbers or mechanics changed (mods now real).

## 12. Auth and onboarding

Auth.js v5: Google provider and Resend magic link. On first session: `POST /api/auth/bootstrap` generates admin and play keypairs, calls `create_player`, stores encrypted keys, then via ops key: `mint_drone` (starter), `mint_item` x2 (Ember skin, random common mod), `mint_volts` 1000; bind both items to the drone and equip them with the player's play key. All idempotent on the user row. The 4-step onboarding tour stays.

## 13. Tests and gas budgets

Contract: per ENGINEERING.md 3. Gas budgets: `create_player` <= 40 TGas, `mint_drone` <= 10, player actions <= 15 each, `reveal_pack` <= 30, `commit_batch` (50) <= 30, `settle_batch` (50) <= 150. Only settlement gas is asserted in sandbox tests: `settle_batch` stays under its budget, which sets the chunk size. Every other method's gas is measured once in the testnet pass and recorded in HANDOFF.md, not asserted. Engine: determinism (1,000 runs), golden set of 20 races in `tests/golden/`, properties. App: per ENGINEERING.md 3 (adapter, scheduler, Zod schemas; no route or service suites); e2e smoke `scripts/smoke-testnet.mjs`.

## 14. Threat model

Assets: items, Volts, treasury, settlement authority, player keys, upgrade authority. Mitigations: scoped keys (4.1); encrypted custody; `seq` idempotency; commit-reveal with chain seed mix-in; `stats_hash` drift check; on-chain lock; team caps; escrow marketplace; owner methods only from the owner account; contract balance funded for storage; rate limits on bootstrap; Origin check; security headers; secret scanning.

## 15. Versions and environment

Rust 1.93.0; near-sdk and near-contract-standards 5.29.1; cargo-near 0.22.0; near-cli-rs 0.30.1; near-sandbox 0.4.0; near-api 0.8.6; near-api-js 7.4.0; Node 24 (>= 22.22.2); Next.js 16.4.4; Pusher. RPC primary `https://near-testnet.drpc.org` (dRPC public, keyless), failover `https://test.rpc.fastnear.com` (FastNear, keyless; `NEAR_RPC_API_KEY` optional); both are the defaults when the env vars are unset. Explorer `https://testnet.nearblocks.io`.
Env: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_RESEND_KEY`, `CRON_SECRET`, `NEAR_NETWORK=testnet`, `NEAR_RPC_URL`, `NEAR_RPC_API_KEY`, `NEAR_RPC_FAILOVER_URL`, `NEAR_OWNER_ID`, `NEAR_GAME_ID`, `NEAR_OPS_KEY`, `NEAR_SETTLEMENT_KEY`, `KEY_ENCRYPTION_KEY`, `ADMIN_KEY_ENCRYPTION_KEY`, `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`, `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`, `NEXT_PUBLIC_EXPLORER_URL`, `ADMIN_EMAILS`, `NEAR_ADAPTER` (`real` default, `mock` for tests), `NEAR_TESTNET_INTEGRATION` (`1` runs the testnet integration test).

## 16. Out of scope

Seasons, mainnet, NEAR Intents (dry-run quote only), Chain Signatures, Shade Agents, per-drone sub-accounts, meta transactions (phase 2 if time), OutLayer (days 9-10 if time).
