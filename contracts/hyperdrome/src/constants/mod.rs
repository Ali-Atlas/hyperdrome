//! Game constants that affect settlement (SPEC.md 2 and 4.6). The app reads them through
//! `get_constants()` and never redefines them.

pub mod catalog;
pub mod names;
pub mod tables;

/// Rarity ids, used as indices into per-rarity tables.
pub const COMMON: u8 = 0;
pub const RARE: u8 = 1;
pub const EPIC: u8 = 2;
pub const LEGENDARY: u8 = 3;

// Drones (SPEC.md 2.1).
pub const STAT_MIN: u8 = 1;
pub const STAT_MAX: u8 = 100;
pub const TSB_BASE: u32 = 9;
pub const TSB_PER_LEVEL: u32 = 20;
pub const CAP_BASE: u32 = 10;
/// Per-stat cap slope in tenths (4.5 per level).
pub const CAP_PER_LEVEL_TENTHS: u32 = 45;
pub const LEVEL_MIN: u8 = 1;
pub const LEVEL_CAP: u8 = 20;
pub const XP_PER_LEVEL_SQUARED: u32 = 200;
pub const XP_WIN: u32 = 10;
pub const XP_LOSS: u32 = 4;
pub const LEVEL_UP_VOLTS: u128 = 20;
pub const START_ELO: i32 = 1_000;
pub const ELO_K: u64 = 32;
pub const TIER_LEVELS: u8 = 5;
pub const TIER_MAX: u8 = 4;
pub const VENDOR_DRONE_PRICE: u128 = 3_500;
pub const VENDOR_STAT_ROLL_MAX: u8 = 5;
/// Milestone drones as (lifetime player races, owned drones must be below).
pub const MILESTONE_DRONES: [(u32, u32); 2] = [(1_000, 2), (3_000, 3)];

// Players (SPEC.md 2.2).
pub const STARTER_VOLTS: u128 = 1_000;
/// Active slots as (slot number, lifetime player races needed).
pub const ACTIVE_SLOTS: [(u8, u32); 3] = [(1, 0), (2, 500), (3, 2_000)];
/// Post-race skin drop chance per human win, in bp, by rarity (common, rare, epic, legendary).
pub const SKIN_DROP_BP: [u16; 4] = [500, 200, 50, 10];

// Races (SPEC.md 2.3).
pub const CADENCE_S: u64 = 180;
pub const STRATEGY_WINDOW_MS: u64 = 120_000;
pub const BOT_BRACKET_FILL: u32 = 5;
pub const WINNER_PAYOUT_BASE: u128 = 3;
pub const WINNER_LEVEL_DIVISOR: u128 = 2;
pub const WINNER_DIFFICULTY_DIVISOR: u128 = 2;
pub const WINNER_ELO_GAP_DIVISOR: u128 = 100;
/// Dominance bonus as (margin percent strictly above, bonus Volts), checked in order.
pub const DOMINANCE: [(u32, u128); 2] = [(40, 5), (20, 2)];
pub const LOSER_PAYOUT_BASE: u128 = 1;
pub const LOSER_LEVEL_DIVISOR: u128 = 4;

// Marketplace (SPEC.md 2.8).
pub const MARKET_RAKE_BP: u128 = 1_000;
pub const MARKET_MIN_PRICE: u128 = 10;

// Packs (SPEC.md 2.7; reveal byte map in SPEC.md 4.4 `reveal_pack`).
pub const PACK_SLOTS: usize = 3;
/// Rarity roll of slot i: u32 LE at bytes [4i, 4i + 4) of the reveal result.
pub const PACK_ROLL_OFFSET: usize = 0;
/// Template pick of slot i: u32 LE at bytes [12 + 4i, 16 + 4i).
pub const PACK_PICK_OFFSET: usize = 12;
/// Placeholder name pick of slot i: u16 LE at bytes [24 + 2i, 26 + 2i).
pub const PACK_NAME_OFFSET: usize = 24;
/// Pack odds are in basis points.
pub const ODDS_SCALE_BP: u64 = 10_000;

// AI teams (SPEC.md 2.10).
pub const TEAM_COUNT: u8 = 4;
pub const TEAM_DRONE_LEVELS: [u8; 3] = [4, 5, 8];
pub const TEAM_BOUND_SKINS: u8 = 2;
pub const TEAM_BOUND_MODS: u8 = 3;
pub const TEAM_START_VOLTS: u128 = 20_000;
pub const TEAM_PER_TX_CAP: u128 = 5_000;
pub const TEAM_PER_DAY_CAP: u128 = 15_000;
pub const TEAM_RESERVE: u128 = 5_000;

// Accounts (SPEC.md 4.1).
/// Balance each player or team account is created with, in yoctoNEAR (0.05 NEAR).
pub const PLAYER_ACCOUNT_BALANCE_YOCTO: u128 = 50_000_000_000_000_000_000_000;
/// Play key allowance, in yoctoNEAR (1 NEAR).
pub const PLAY_KEY_ALLOWANCE_YOCTO: u128 = 1_000_000_000_000_000_000_000_000;
/// Methods the play function-call key may call.
pub const PLAY_KEY_METHODS: &str =
    "allocate_stats,equip,bind,list,buy,cancel,open_pack,reveal_pack,vendor_buy_drone";
pub const PLAYER_PREFIX: &str = "p-";
pub const SLUG_MIN_LEN: usize = 3;
pub const SLUG_MAX_LEN: usize = 20;
pub const DAY_MS: u64 = 86_400_000;

// Metadata (SPEC.md 4.3).
pub const VOLTS_NAME: &str = "Volts";
pub const VOLTS_SYMBOL: &str = "VOLT";
pub const VOLTS_DECIMALS: u8 = 0;
pub const NFT_NAME: &str = "Hyperdrome";
pub const NFT_SYMBOL: &str = "HDROME";

// Token id prefixes (SPEC.md 4.2).
pub const DRONE_PREFIX: &str = "d:";
pub const SKIN_PREFIX: &str = "s:";
pub const MOD_PREFIX: &str = "m:";
