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
| Starter kit                               | 1 starter drone, 1 Ember common skin, 1 random common mod (template 1-10), 1,000 Volts   |
| Active slots                              | 1; slot 2 at 500 lifetime player races; slot 3 at 2,000; max 3                           |
| Post-race skin drop (winner, humans only) | legendary 0.1%, epic 0.5%, rare 2%, common 5% per win; from catalog supply, else nothing |

Ember (template 4) is the starter skin: exempt from the supply cap, excluded from pack and vendor rolls, does not count in get_catalog supply. (The exemption is a T6 contract change; until it ships, the starter mint counts against Ember's cap of 10.)

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
Supply caps per template (new, tunable): common 10, rare 6, epic 4, legendary 3. When a rarity has no supply left, packs mint a placeholder skin of that rarity (name from the placeholder pools in the baseline `services/pack.service.js`, image `/placeholder/`), unlimited. Token images for placeholders and mods are a generated card from `/api/metadata/<token>/image` (8) until art files exist.
Equip rule: legendary skins equip on any tier; other skins equip only where a tier render exists: ember tier 1; chrome_fury, crystal_phantom, dragon_scale, frozen_abyss, obsidian_core tier 4. (Carried from baseline; tier renders are the content gap.)
Ember (template 4) is the starter skin: exempt from the supply cap, excluded from pack and vendor rolls, does not count in get_catalog supply.
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

4 teams. Per team: 3 drones (levels 4, 5, 8), 2 bound skins and 3 bound mods spread across them, 20,000 Volts. Caps: per transaction 5,000 Volts, per day 15,000 Volts, enforced on-chain. Reserve floor 5,000 Volts (the team never spends below it).

## 3. Architecture

Components: Next.js 16 app on Vercel (pages, API routes, scheduler endpoint hit by Vercel cron every 3 minutes, AI-team runner inside the same tick); Neon Postgres (profiles, sessions, matchmaking inputs, caches of on-chain state, race logs); Pusher Channels (push to browsers); one NEAR contract `game.hyperdrome.testnet` (assets, Volts, economy rules, settlement, player account creation); NEAR testnet RPC (dRPC primary, FastNear failover; section 15).

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

Token ids: drones `d:<n>`, skins `s:<n>`, mods `m:<n>`, with n starting at 1. Template ids are 1-based in the 2.5 and 2.6 listing order: mods 1-26; skins 1-32 (common 1-8, rare 9-16, epic 17-24, legendary 25-32). 0 means "none" in `stats_hash` and snapshots. Rarity ids: common 0, rare 1, epic 2, legendary 3. Bots are drones owned by the contract account. Stats order is the 9 stats in 2.1 order.

### 4.3 Standards

NEP-141 Volts: name "Volts", symbol "VOLT", decimals 0, icon none. `ft_transfer` standard (1 yocto). Storage registration is done by the contract for every player in `register_player` (contract pays).
NEP-171/177/178/181 via `NonFungibleToken`. `nft_transfer` and `nft_transfer_call` by hand: panic "bound item" if the token is a skin or mod with `bound_to`; if the token is a drone, transfer it, then `internal_transfer_unguarded` every bound skin and mod, clear approvals on all, emit one `NftTransfer` listing every moved token; panic "listed" if the token is listed; panic "locked" if `in_batch` is set and the batch is locked. `nft_token` returns metadata with `extra` = JSON summary (level, elo, tier, equipped). NFT collection metadata: spec `nft-1.0.0`, name "Hyperdrome", symbol "HDROME". `nft_metadata.base_uri` = the app's `/api/metadata`, set by the owner with `set_base_uri` (null until the app URL exists). Token `media` = `<base_uri>/<token_id>/image`, null while `base_uri` is null.

### 4.4 Methods

Owner (predecessor == owner_id):

- `create_player(slug: String, admin_pk: PublicKey, play_pk: PublicKey, is_team: bool) -> Promise`: creates `p-<slug>.<current>` (or `<slug>.<current>` when is_team) with CreateAccount, Transfer 0.05 NEAR, AddKey full-access admin_pk, AddKey function-call play_pk (receiver current, methods per 4.1, allowance 1 NEAR); then registers the player in a callback that returns true when the account was created. Panics "bad slug" if slug is not `[a-z0-9]{3,20}`, "exists" if the player is already registered.
- `register_player(account_id)`: FT storage registration and Player row; idempotent.
- `mint_drone(owner, name, level: u8, stats: [u8;9], active_hint: bool) -> TokenId`: validates level in 1-20 ("bad level"), each stat >= 1 ("bad stat") and <= cap(level) ("over cap"), sum <= TSB(level) ("tsb exceeded"); elo 1000; emits NftMint and `drone_minted`. `active_hint` is not stored (active flags live in the database).
- `mint_item(owner, kind, template: u16, placeholder_name: Option<String>) -> TokenId`: enforces skin supply caps unless placeholder ("no supply"); "bad template" for an unknown template or a placeholder name on a mod; emits NftMint and `item_minted`.
- `mint_volts(to, amount)`: emits FtMint.
- `set_team_budget(account, per_tx, per_day)`; `set_paused(bool)`; `set_base_uri(base_uri: Option<String>)` sets `nft_metadata.base_uri`.

Player (predecessor is a registered player; every method takes `seq: u64` which must equal `player.seq + 1`, then stores it; panics "bad seq" otherwise; panics "paused" when paused):

- `allocate_stats(drone, stats: [u8;9], seq)`: owner check; no decrease; each <= cap; sum <= TSB; cost per 2.1 debited from Volts; drone not locked; emits `stats_allocated`.
- `equip(drone, item: Option<TokenId>, kind, seq)`: owner check; item bound to this drone; skin tier rule 2.6; drone not locked; emits `equipped`.
- `bind(drone, item, seq)`: owner owns both; item unbound; not listed; sets both sides; auto-equips if the slot is empty, the drone is not locked and (for skins) the 2.6 tier rule allows it; emits `item_bound`, plus `equipped` when it auto-equips.
- `list(token, price, seq)`: owner check; price >= 10; not bound (for items); not already listed; token moves to contract escrow (internal transfer to current account, drone keeps racing and keeps `in_batch`); emits `listed`.
- `buy(token, seq)`: listing active; buyer != seller; Volts >= price; team cap check if buyer is a team; debit buyer, credit seller 90%, treasury 10%; transfer token (and bound items) to buyer; remove listing; emits `sold` plus NftTransfer and FtTransfer events.
- `cancel(token, seq)`: seller check; token returns; emits `cancelled`.
- `open_pack(kind, tier, hash: [u8;32], seq) -> u64`: price per 2.7 debited (FtBurn); team cap check; stores PackCommit with current height; emits `pack_committed`.
- `reveal_pack(pack_id, secret: [u8;32], seq)`: buyer check; `env::block_height() > height`; `sha256(secret) == hash`; result = sha256(secret ++ env::random_seed() ++ pack_id LE bytes); three rolls r_i = u32 from bytes [4i..4i+4] / 2^32; rarity per 2.7; template uniform among the rarity's templates with supply left (skins) or all templates of that rarity (mods); mint 3 items to buyer; marks revealed; emits `pack_opened` with the token ids.
- `vendor_buy_drone(seq)`: 3,500 Volts burned; stats from random_seed per 2.1; plus one common skin and one common mod minted and bound; emits `drone_minted`.

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

Panic messages are short lowercase strings and are the contract's API for failure paths: `paused`, `bad seq`, `not owner`, `not player`, `locked`, `bound item`, `listed`, `not listed`, `self buy`, `insufficient volts`, `over cap`, `cap exceeded`, `tsb exceeded`, `stat decrease`, `tier`, `bad slug`, `exists`, `state drift`, `bad reveal`, `too early`, `settled`, `not implemented`, `not found`, `same owner`, `bad level`, `bad stat`, `bad template`, `no supply`.

## 5. Engine (`lib/game-engine`, pure JS)

`simulateRace({ seed, raceId, droneA, droneB, track, weather, timeOfDay }) -> { winner: 'a'|'b', timeAms, timeBms, log }`. `seed` is the batch seed (hex), `raceId = "<batchId>:<index>"`; the race PRNG is xoshiro128** seeded with the first 16 bytes of sha256(seedBytes || utf8(raceId)), read as four little-endian u32 words (an all-zero state becomes 1, 2, 3, 4); `nextUnit()` = (next32() >>> 8) / 2^24. Draw order is exactly the baseline order: per lap, split straights (one draw per run except the last, which takes what is left), shuffle (Fisher-Yates), split turns, shuffle, start type; per segment: subtype pick, jitter, noise A, noise B; tie-break last, drawn only when the two millisecond totals are equal. `droneA/B` carry effective stats after mod application (`applyMod(stats, modTemplate)` in `lib/game-engine/mods.js`) and the special id; Phantom Drive and Storm Rider act in `scoreSegment`, Quantum Sync in the per-segment noise. `log` is client-safe: per segment `{lap, type, gapMs}` only, where `gapMs = Math.round((cumulative A - cumulative B) * 1000)` from the float sums (so the last `gapMs` can differ by 1 from `timeAms - timeBms`). Times are integers in milliseconds, computed from float seconds as `Math.round(t * 1000)` after the full sum so replay is byte-stable. `statsHash(stats9, modTemplateId, skinTemplateId)` in `lib/game-engine/stats-hash.js` mirrors the contract's `stats_hash` (sha256 of 9 stat bytes, u16 mod template LE, u16 skin template LE, 0 = none); `tests/golden/stats-hash.json` holds the shared test vectors. SHA-256 is a synchronous pure-JS implementation so replay runs the same in the browser. Mod templates live in `lib/game-engine/templates.js`, a mirror of the contract's `constants/catalog.rs` checked by a test.

## 6. Server and chain adapter (`lib/near`)

near-api-js 7.4.0, Node 22+. Nothing outside `lib/near` imports it (ESLint `hyperdrome/near-boundary`). Files: `config.js` (env, Zod), `provider.js`, `keys.js`, `events.js`, `errors.js`, `explorer.js`, `adapter.js` (real), `mock.js` (in-memory, same interface), `index.js` (`getNear()` returns the process singleton; `NEAR_ADAPTER=mock` selects the mock). Interface (JSDoc types in `index.js`); every call returns `{ txHash, result, events }`, `events` being the parsed `EVENT_JSON` logs in receipt order:

- `createPlayerAccount({ slug, isTeam }) -> { accountId, playKeyEnc, adminKeyEnc, keyVersion: 1, txHash }`: generates both ed25519 keypairs locally, calls `create_player` with the ops key (60 TGas), returns the keys sealed for storage. `AccountCreateError` if the callback returns false. On `RpcUnknownOutcomeError` the sealed keys are on `err.pending`, so the caller can store them before resolving.
- `callAsPlayer(accountId, playKeyEnc, method, args, { gas = 30 TGas })`: opens the play key, reads `get_player(account).seq` and sends `seq + 1` in the args (the caller never supplies seq).
- `callAsOps(method, args, { gas = 30 TGas })` (signed by `NEAR_OWNER_ID` with `NEAR_OPS_KEY`); `callAsSettlement(method, args, { gas = 200 TGas })` (signed by `NEAR_GAME_ID` with `NEAR_SETTLEMENT_KEY`).
- `view(method, args)` (optimistic finality; if every provider fails, one more failover round; contract panics are not retried); `getConstants()` cached per process.
- `nextSeq(accountId)`: the seq the next player call carries (`get_player(...).seq + 1`); panics `not player` when unregistered.
- `resolveOutcome(accountId, seq, txHash, { senderId = accountId })`: after `RpcUnknownOutcomeError`, if the on-chain seq reached `seq`, fetches the transaction by hash (looked up under `senderId`, the signer: the owner for `create_player`) and returns `{ applied: true, txHash, result, events }`; otherwise (or if that transaction failed with `bad seq`) `{ applied: false }`, so the caller may retry.
- `rotatePlayKey(accountId, adminKeyEnc, { keyVersion }) -> { playKeyEnc, keyVersion: keyVersion + 1, txHash }`: the only code path that opens an admin key; one transaction signed with it: DeleteKey for every function-call key scoped to the game contract, AddKey for a new play key (methods per 4.1, 1 NEAR allowance).
- `explorerTx(hash)` = `<explorer>/txns/<hash>`, `explorerAccount(id)` = `<explorer>/address/<id>`; `ownerId` and `gameId` are the configured accounts.
- Mock (`mock.js`): `mock.failNextSend('applied' | 'lost')` makes the next create, ops or player send end in `RpcUnknownOutcomeError` (a create carries `err.pending`); `mock.on(method, handler)` supplies results, events and views.
- `sealSecret(bytes, keyHex, aad)`, `openSecret(blob, keyHex, aad)`: AES-256-GCM, 12-byte IV, 16-byte tag, key = 64 hex chars; blob = base64(version byte 1 ++ IV ++ tag ++ ciphertext); AAD = the row it belongs to (the account id for keys). Play keys under `KEY_ENCRYPTION_KEY`, admin keys under `ADMIN_KEY_ENCRYPTION_KEY`; `key_version` on the row. Also used for batch seeds.
- Sending: transactions are built and signed in the adapter (hash known before sending), sent with `waitUntil: 'EXECUTED'` (the transaction's block is final and every non-refund receipt has executed), deposit always 0. After a send timeout, or an InvalidNonce (after a failover the second node usually rejects the same signed transaction because the first already executed it), the adapter looks the transaction up by hash (3 attempts) and returns that outcome; it raises `RpcUnknownOutcomeError` or `NonceError` only when the hash is unknown. Ops and settlement calls carry no seq, so this is what stops a rebuilt resend from applying twice.
- Errors (`errors.js`): `ContractPanicError` (`panic` = the 4.8 string, `method`, `txHash`), `KeyAllowanceError` (NotEnoughAllowance), `NonceError` (InvalidNonce; ops and settlement reset their nonce cache), `RpcUnknownOutcomeError` (`txHash`, `accountId`, `seq`), `AccountCreateError`, `TransactionFailedError` (a non-panic failure). Other errors propagate unchanged. Logging is `console.error({ scope: 'near', msg, ...fields })` only.
- RPC: near-api-js `FailoverRpcProvider` over `NEAR_RPC_URL` then `NEAR_RPC_FAILOVER_URL` (defaults in 15), each call raced against a 10 s timeout (near-api-js has none), 2 retries inside a provider. `NEAR_RPC_API_KEY`, when set, is sent as `Authorization: Bearer` to whichever URL is FastNear.
  Scheduler (`/api/races/run`, Vercel cron `*/3 * * * *`, CRON_SECRET): claim `cron_ticks(slot)`; phase 0 teams; phase 1 settle; phase 2 commit; each chain call idempotent by `batch_id`; on failure the batch stays in its state and the next tick retries.
  Matchmaking input: DB `drones.active` plus on-chain `in_batch == null`.
  Seed: 32 random bytes from `crypto.randomBytes`, stored AES-encrypted in `batches.seed_enc` until settled, then stored plain for replay.

## 7. Data model (Drizzle, changes to the baseline)

Migrations in `drizzle/`, generated by drizzle-kit from `lib/db/schema.js` (T10 tables in `lib/db/schema-gameplay.js`, re-exported) and applied with `npm run db:migrate`: `0000_initial.sql`, `0001_gameplay_actions.sql` (T10) (CI applies it to its Postgres service before tests); the NEAR build starts from a fresh Neon database. `lib/db` uses Neon's HTTP driver for Neon URLs and node-postgres for any other Postgres.
users: + `near_account_id` unique, `play_key_enc`, `admin_key_enc`, `key_version`, `is_team`, `team_persona`, `bootstrap_state` enum (`none`, `account`, `minted`, `done`; default `none`), `bootstrap_pending jsonb` (array of `create_player` attempts with an unknown outcome: `{ accountId, playKeyEnc, adminKeyEnc, keyVersion, txHash, slug }`, cleared when one is adopted or a create succeeds), `bootstrap_claimed_at` (the bootstrap lease), `action_claimed_at` (the per-user action lease, 8); `points` becomes a cache of `ft_balance_of`. drones, skins, mods: `token_id` text unique (replaces the integer MegaETH columns) and `chain_synced_at`; skins and mods + `template` smallint (4.2 template id); on-chain fields (stats, level, xp, elo, wins, losses, equipped, bound) become caches; bound and equipped items are cached in `drone_skins` / `drone_mods` (`is_equipped`) and `drones.applied_skin_id` / `applied_mod_id`. New: `batches(slot pk, seed_hash, seed_enc, seed, status committed|settled|failed, commit_tx, settle_txs json, committed_at, settled_at)`; `cron_ticks(slot pk, started_at)`; `actions(id uuid = the client action id, user_id, method, seq, args json (a pack reveal stores no secret), tx_hash, status pending|applied|failed, created_at, result jsonb (the 200 body a replay gets), error text, http_status int)`; `pack_opens(action_id pk, user_id, pack_id unique, kind, tier 0-2, secret_enc, status pending|committed|revealed, commit_tx, reveal_tx, tokens jsonb, created_at)` (secret sealed under `KEY_ENCRYPTION_KEY`, AAD = the action id; written before `open_pack`); `rate_limits(bucket, window_start, count, primary key (bucket, window_start))` (fixed windows; buckets `mutation:<user id>` and `demo:<ip hash>`); `teams(user_id pk, name, persona json, reserve)`; races: + `batch_slot`, `race_index` (unique together), `seed`, `snapshot_a json`, `snapshot_b json`, `settle_tx`, `log json (client-safe)`. marketplace_listings: + `token_id` (the listing cache, from `listed`, `sold`, `cancelled`). Removed: `demo_signups` (T10, onto `rate_limits`), wallet_address, starter_volt_minted_at, starter_gas_sent_at, mint_tx_hash, minted_at, onchain_listing_id, list_tx_hash, pack_purchases, token_counters, epoch_id, settle_tx_hash.

## 8. API routes (all mutations: session required, Zod body, ownership check, `action_id` idempotency via `actions`, rate limit, Origin check)

Auth: Auth.js handlers; `POST /api/auth/bootstrap` (session, Origin, no body; runs or resumes the bootstrap in 12; 200 `{ state: 'done', accountId, explorerUrl, droneId }`, 202 while another request holds it or an outcome is unknown, 502 with `{ error }` when a chain step failed); `POST /api/auth/demo` (Origin; signs in a fresh `PILOT_` demo user). Shared helpers: `lib/http/origin.js` (Origin check), `lib/http/session.js` (session or 401), `lib/http/mutation.js` (every gameplay mutation, in order: Origin 403, session 401, `rate_limits` 30 per user per minute 429, JSON body 400, strict Zod body 400), `lib/http/chain-errors.js` (each 4.8 panic string to a status and player-facing copy: e.g. `locked` 409, `insufficient volts` 402, `not owner` 403, `not found` and `not listed` 404, `over cap`, `tsb exceeded`, `stat decrease`, `low price` 422, `cap exceeded` 429, `paused` and `not implemented` 503; an unknown string 422). Drones: `GET /api/drones` (own fleet), `GET /api/drones/[id]` (one cached drone with owner id, username and NEAR account, equipped and bound items, last 10 races; public, no balances), `POST /api/drones/[id]/allocate` `{ actionId, stats[9] }` (the full new stat line), `/equip` `{ actionId, kind: skin|mod, item: token|null }` (the item must be bound to the drone), `/bind` `{ actionId, item }` (an unbound skin or mod the player owns), `/toggle` `{ active }` (DB only, no actionId; activating checks the 2.2 slots from `users.total_races`; 200 `{ data: drone }`), `POST /api/drones/vendor` `{ actionId }`. Marketplace: `GET /api/marketplace` (the listings cache, paged by `page` and `limit`, filters `item_type`, `status=sold`, `min_price`, `max_price`), `POST /api/marketplace/list` `{ actionId, token, price }` (whole Volts, at least 10; not already listed; items unbound), `/buy` `{ actionId, token }` (an active listing of another seller), `/cancel` `{ actionId, token }` (the seller's active listing), `POST /api/packs/open` `{ actionId, kind: skin|mod, tier: starter|premium|legendary }` (commit then reveal in one request, below), `GET /api/packs/[id]` (the player's own pack open by action id or pack id: status, transactions, tokens and items, never the secret). Races: `GET /api/races`, `GET /api/races/[id]` (with seed and snapshots once settled), `GET /api/races/next`, `GET /api/races/upcoming`, `GET /api/races/[id]/verify` (server replay, returns match true/false), `POST /api/races/run` (cron). Read: `GET /api/leaderboard`, `GET /api/users/[id]/profile` (no balances), `GET /api/tracks`, `GET /api/constants`, `GET /api/health`, `GET /api/metadata/[token]` and `/image` (below), `GET /api/stats` (live strip: next slot, last batch, volts minted and burned, trades today from cached events). Pusher: `POST /api/pusher/auth`.

Action path (`services/action.service.js` `runPlayerAction({ userId, actionId, method, args, onApplied })`, used by every chain mutation): the user must be bootstrap `done` (else 409); a replayed `actionId` whose row is applied or failed gets the stored answer with no chain call, and an `actionId` used by another user or method gets 409; the user's lease `users.action_claimed_at` is taken with a conditional UPDATE (30 s), so one player never has two chain calls in flight (they would carry the same seq and nonce), else 409 "Another action is still in progress."; the `actions` row is inserted (id = `actionId`, ON CONFLICT DO NOTHING) before sending; a pending row with a tx hash is resolved with `resolveOutcome` first (applied: finished from that outcome; not applied: sent again); then `callAsPlayer`. Outcomes: applied stores tx_hash, status `applied` and the 200 body `{ actionId, txHash, explorerUrl, result, ... }`, then runs `onApplied(events)` (the caches; a cache failure is logged and the answer stays 200); `ContractPanicError` stores status `failed` with the mapped status and error (`bad seq` and caller-named transient panics such as `too early` leave the row pending and retryable); `TransactionFailedError` stores failed with 502; `RpcUnknownOutcomeError` keeps the row pending with tx_hash and seq and answers 202 `{ pending: true, actionId, txHash }`, and the same request again resolves it; any other error (not sent) leaves the row pending without a hash and answers 503. Ownership is checked against the cache before a first send (the contract enforces it again); a replay skips that check. Caches (`services/chain-cache.service.js` `applyEvents(events)`): `drone_minted` and `item_minted` insert cache rows (reading `get_drone` for stats and name, `get_item` for a placeholder name), `stats_allocated`, `item_bound` and `equipped` update the drone and its `drone_skins` / `drone_mods` rows, `listed`, `sold` and `cancelled` the listings cache, nep171 `nft_transfer` the owner (escrow moves to the contract keep the seller as the cached owner; a sale parks a drone inactive), and any nep141 movement re-reads `ft_balance_of` into `users.points`. T9 adds `batch_settled`.

Packs (`services/pack-open.service.js`): the server makes a 32-byte secret, seals it into a `pack_opens` row before anything is sent, sends `open_pack` with sha256(secret) (status `committed`, pack id stored), then `reveal_pack` under a derived action id (a uuid from sha256(`reveal:` ++ actionId); its stored args omit the secret). The reveal is a later block by construction (the commit has executed); on `too early` it waits 1 s and retries once. The same `actionId` again resumes from the stored row, so a crash between the calls never loses the burned Volts. 200 `{ actionId, packId, tokens, items, txHash, commitTxHash, ... }`; 202 while an outcome is unknown.

Token metadata (`services/metadata.service.js`, from the cache, public): `GET /api/metadata/[token]` returns NEP-177 metadata (title, description, `media` = `<origin>/api/metadata/<token>/image`, copies 1, `extra` with the contract's keys: drones `kind, level, elo, tier, equipped { mod, skin }`; items `kind, template, rarity, bound_to`), cached 60 s. `/image` redirects (302, cached 60 s) to the art file: a drone's equipped-skin render for its tier where one exists (legendary art on any tier), else `/drones/tier-<n>.webp`; a skin's `/skins/<rarity>/<file>.webp`. Mods and placeholder skins get a generated SVG card (rarity colors from `app/globals.css`, every text value escaped, no scripts or external references, `image/svg+xml`, cached 1 day) until art exists; `MOD_ART` in the service switches a template to its file with no change to the metadata. Security headers on every route (`next.config.mjs`): `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`; no CSP yet.

## 9. Real-time (Pusher)

Channel `public`: `race:next {slot, startsAt, paused}`, `batch:committed {slot, count}`, `batch:settled {slot, txs, summary}`. Channel `private-user-<id>`: `race:matchup {race}`, `race:result {race}`, `user:balance {volts}`. Clients fall back to a 30 s poll of `/api/races/next` if Pusher is unavailable.

## 10. AI teams

Teams: `vortex` (Vortex Dynamics: speed and straights), `nimbus` (Nimbus Racing: rain and night), `hairpin` (Hairpin Collective: turning and durability), `static` (Static Union: consistency and battery). Each is a user row with `is_team`, a NEAR account, persona weights over the 9 stats, and caps per 2.10. Phase 0 each tick, per team: (a) for every drone with an open matchup, pick the bound mod with the best fit score = sum over the mod's bonus stat weight in the track's subtype mix (straights/turns ratio) plus condition relevance (rain/heavy_rain -> rain_handling, night/fog/haze -> night_vision, wind -> wind_resistance) minus penalty weight; equip if it differs; (b) on level-up, allocate all affordable points along persona weights; (c) if Volts - reserve >= capsule price and the team has fewer than 6 unbound mods, open a starter capsule (premium when Volts - reserve >= 20,000); (d) list the lowest-fit unbound mod at 1.2x the rarity base price (common 150, rare 800, epic 3,500, legendary 12,000); (e) buy a listed mod when its fit for some drone beats the current best by 2 or more and price <= 0.8x rarity base and within caps. Every action goes through `callAsPlayer` with the team's play key; on-chain caps are the hard limit.

## 11. Pages touched

Landing: live strip (next race countdown, last batch results ticker, volts minted and burned today, trades today, explorer link). Dashboard: matchup card for each active drone (opponent, track, weather, time, each side's edge computed from 2.4 weights, equipped mod with swap control, lock countdown). Drone detail: on-chain panel (token id, explorer link, owner), stats editor, bound items with equip controls, XP bar. Marketplace: split into `ListingGrid`, `ListingCard`, `SellModal`, `BuyModal`, `PackShop`, `CapsuleShop`; on-chain path only. Race detail: result, client-safe gap chart, settle tx link, "Verify" button replays in the browser from seed and snapshots and shows match. Leaderboard: team badge. Profile: fleet, record, recent races. Copy for Guide and FAQ updated where numbers or mechanics changed (mods now real).

## 12. Auth and onboarding

Auth.js v5 (JWT session carrying the user id, Drizzle adapter) with Google and a server-only demo provider behind Play Demo (sign-in page `/login` shows both; no email sign-in, DECISIONS.md 3.13) (`POST /api/auth/demo` creates a `PILOT_` user; guarded by `AUTH_SECRET`; limits in the database: 5 per IP per hour through `rate_limits` (bucket `demo:` ++ sha256(AUTH_SECRET ++ ip), fixed one-hour window, counted before compared), and `DEMO_ACCOUNT_CAP` demo users in total). The `createUser` event only sets the username (email local part, uppercased letters and digits, 4-digit suffix on a clash).
Bootstrap (`services/bootstrap.service.js`, via `POST /api/auth/bootstrap`, called by the dashboard while `bootstrap_state != done`): a state machine on `users.bootstrap_state`. A request first claims a 120 s lease (`bootstrap_claimed_at`, conditional UPDATE), so two requests never act at once; each transition is `UPDATE ... WHERE bootstrap_state = <expected>`. Steps, each idempotent and resumable:

1. `none -> account`: resolve every stored `bootstrap_pending` attempt with `resolveOutcome(accountId, 0, txHash, { senderId: owner })` and adopt the first that executed and returned true; an attempt that executed and failed (a panic such as `exists` when another player took the slug, a non-panic failure, or a false callback) is dropped from `bootstrap_pending`; otherwise `createPlayerAccount({ slug, isTeam: false })` with the slug from the username (`[a-z0-9]{3,20}`: lowercase letters and digits, first 20, `pilot` in front when fewer than 3), a 4-hex suffix on `exists` or a false callback (base cut to 16, 5 attempts). On `RpcUnknownOutcomeError` the sealed keys go to `bootstrap_pending` and the state stays `none`.
2. `account -> minted`: read `nft_tokens_for_owner` and adopt tokens already owned; then with the ops key, only what is missing: `mint_drone` (all stats 1, level 1, name from `drone-names`), `mint_item` Ember (skin template 4), `mint_item` one common mod (template 1-10 from `crypto.randomInt`), `mint_volts` up to 1,000 (`ft_balance_of` first). Each token id is written to its drones, skins or mods cache row as it is minted.
3. `minted -> done`: `bind` the skin and the mod with the player's play key where `get_drone` shows them unbound (bind auto-equips an empty slot, so no equip call); `drone_skins`, `drone_mods` and `drones.applied_*` updated from the `item_bound` and `equipped` events; `users.points` set from `ft_balance_of`.
   The dashboard panel shows the step and the explorer link, retries on 202 and reloads when done. The 4-step onboarding tour stays.

## 13. Tests and gas budgets

Contract: per ENGINEERING.md 3. Gas budgets: `create_player` <= 40 TGas, `mint_drone` <= 10, player actions <= 15 each, `reveal_pack` <= 30, `commit_batch` (50) <= 30, `settle_batch` (50) <= 150. Only settlement gas is asserted in sandbox tests: `settle_batch` stays under its budget, which sets the chunk size. Every other method's gas is measured once in the testnet pass and recorded in HANDOFF.md, not asserted. Engine: determinism (1,000 runs), golden set of 20 races in `tests/golden/`, properties. App: per ENGINEERING.md 3 (adapter, scheduler, Zod schemas; no route suites), plus the bootstrap, action-path and pack-open services against the mock adapter and a real Postgres (DECISIONS.md 5.26); e2e smoke `scripts/smoke-testnet.mjs`.

## 14. Threat model

Assets: items, Volts, treasury, settlement authority, player keys, upgrade authority. Mitigations: scoped keys (4.1); encrypted custody; `seq` idempotency; commit-reveal with chain seed mix-in; `stats_hash` drift check; on-chain lock; team caps; escrow marketplace; owner methods only from the owner account; contract balance funded for storage; a single bootstrap per user (lease-claimed state machine, 12) and demo-account limits in the database (per IP, and a lifetime `DEMO_ACCOUNT_CAP`); one chain call in flight per player (action lease) and 30 mutations per player per minute (`rate_limits`); idempotent actions by client `actionId`; Origin check; security headers; secret scanning.

## 15. Versions and environment

Rust 1.93.0; near-sdk and near-contract-standards 5.29.1; cargo-near 0.22.0; near-cli-rs 0.30.1; near-sandbox 0.4.0; near-api 0.8.6; near-api-js 7.4.0; Node 24 (>= 22.22.2); Next.js 16.4.4; Pusher. RPC primary `https://near-testnet.drpc.org` (dRPC public, keyless), failover `https://test.rpc.fastnear.com` (FastNear, keyless; `NEAR_RPC_API_KEY` optional); both are the defaults when the env vars are unset. Explorer `https://testnet.nearblocks.io`.
Env: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `CRON_SECRET`, `NEAR_NETWORK=testnet`, `NEAR_RPC_URL`, `NEAR_RPC_API_KEY`, `NEAR_RPC_FAILOVER_URL`, `NEAR_OWNER_ID`, `NEAR_GAME_ID`, `NEAR_OPS_KEY`, `NEAR_SETTLEMENT_KEY`, `KEY_ENCRYPTION_KEY`, `ADMIN_KEY_ENCRYPTION_KEY`, `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`, `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`, `NEXT_PUBLIC_EXPLORER_URL`, `ADMIN_EMAILS`, `DEMO_ACCOUNT_CAP` (lifetime demo accounts, default 100), `NEAR_ADAPTER` (`real` default, `mock` for tests), `NEAR_TESTNET_INTEGRATION` (`1` runs the testnet integration test).

## 16. Out of scope

Seasons, mainnet, NEAR Intents (dry-run quote only), Chain Signatures, Shade Agents, per-drone sub-accounts, meta transactions (phase 2 if time), OutLayer (days 9-10 if time).
