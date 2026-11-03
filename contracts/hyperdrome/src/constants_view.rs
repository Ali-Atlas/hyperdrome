//! JSON shape of `get_constants()`: every table in SPEC.md 2 and 4.6. Fractions keep the fixed
//! point of `constants::tables` (`_milli` parts per thousand, `_bp` basis points).

use near_sdk::json_types::U128;
use near_sdk::near;

use crate::constants::catalog::{
    MODS, ModTemplate, RARITY_NAMES, SKIN_SUPPLY_CAP, SKIN_TIER_RENDERS, SKINS,
    STARTER_SKIN_TEMPLATE, STAT_NAMES,
};
use crate::constants::tables::{
    BRACKETS, CONDITIONS, ENGINE_BATTERY_FADE_MILLI, ENGINE_JITTER_MILLI, ENGINE_LAPS,
    ENGINE_LENGTH_MULT_MILLI, ENGINE_NOISE_STRAIGHT_MILLI, ENGINE_NOISE_TURN_MILLI, ENGINE_RUN_MAX,
    ENGINE_RUN_MIN, ENGINE_SCORE_COEF_US, ENGINE_SCORE_FLOOR_MILLI, ENGINE_SEGMENT_MAX_MS,
    ENGINE_SEGMENT_MIN_MS, ENGINE_STRAIGHT_BASE_MS, ENGINE_STRAIGHT_PER_DIFFICULTY_MS,
    ENGINE_TURN_BASE_MS, ENGINE_TURN_PER_DIFFICULTY_MS, LENGTH_NAMES, PACK_TIERS, POW10,
    POW10_STEP, SUBTYPES, TIME_OF_DAY, TRACKS, WEATHER,
};
use crate::constants::*;

#[near(serializers = [json])]
pub struct ModTemplateView {
    pub id: u16,
    pub name: String,
    pub rarity: u8,
    pub bonus_stat: Option<u8>,
    pub bonus_pct: u8,
    pub penalty_stat: u8,
    pub penalty_pct: u8,
    pub special: Option<String>,
}

impl From<&ModTemplate> for ModTemplateView {
    fn from(t: &ModTemplate) -> Self {
        Self {
            id: t.id,
            name: t.name.to_string(),
            rarity: t.rarity,
            bonus_stat: t.bonus_stat,
            bonus_pct: t.bonus_pct,
            penalty_stat: t.penalty_stat,
            penalty_pct: t.penalty_pct,
            special: t.special.map(str::to_string),
        }
    }
}

#[near(serializers = [json])]
pub struct SkinTemplateView {
    pub id: u16,
    pub slug: String,
    pub file: String,
    pub rarity: u8,
}

#[near(serializers = [json])]
pub struct TrackView {
    pub id: u8,
    pub name: String,
    pub min_level: u8,
    pub max_level: u8,
    pub difficulty: u8,
    pub straights: u8,
    pub turns: u8,
    pub length: String,
    pub has_art: bool,
}

#[near(serializers = [json])]
pub struct PackTierView {
    pub id: u8,
    pub name: String,
    pub skin_pack_price: U128,
    pub mod_capsule_price: U128,
    /// (rarity, bp), cumulative in this order.
    pub slot1: Vec<(u8, u16)>,
    pub slots23: Vec<(u8, u16)>,
}

#[near(serializers = [json])]
pub struct SubtypeView {
    pub name: String,
    pub is_turn: bool,
    pub mult_milli: u16,
    pub weights_milli: Vec<(u8, u16)>,
}

#[near(serializers = [json])]
pub struct ConditionView {
    pub when: String,
    pub stat: u8,
    pub divisor: u8,
    pub min_milli: u16,
    pub max_milli: u16,
}

#[near(serializers = [json])]
pub struct DroneConstants {
    pub stat_min: u8,
    pub stat_max: u8,
    pub tsb_base: u32,
    pub tsb_per_level: u32,
    pub cap_base: u32,
    pub cap_per_level_tenths: u32,
    pub level_cap: u8,
    pub xp_per_level_squared: u32,
    pub xp_win: u32,
    pub xp_loss: u32,
    pub level_up_volts: U128,
    pub start_elo: i32,
    pub elo_k: u64,
    pub tier_levels: u8,
    pub vendor_price: U128,
    pub vendor_stat_roll_max: u8,
    pub milestone_drones: Vec<(u32, u32)>,
}

#[near(serializers = [json])]
pub struct RaceConstants {
    pub cadence_s: u64,
    pub strategy_window_ms: u64,
    pub brackets: Vec<(String, u8, u8)>,
    pub bot_bracket_fill: u32,
    pub weather: Vec<String>,
    pub time_of_day: Vec<String>,
    pub winner_payout_base: U128,
    pub winner_level_divisor: U128,
    pub winner_difficulty_divisor: U128,
    pub winner_elo_gap_divisor: U128,
    pub dominance: Vec<(u32, U128)>,
    pub loser_payout_base: U128,
    pub loser_level_divisor: U128,
}

#[near(serializers = [json])]
pub struct EngineConstants {
    pub laps: u8,
    pub run_min: u8,
    pub run_max: u8,
    pub subtypes: Vec<SubtypeView>,
    pub jitter_milli: u16,
    pub straight_base_ms: u32,
    pub straight_per_difficulty_ms: u32,
    pub turn_base_ms: u32,
    pub turn_per_difficulty_ms: u32,
    pub score_coef_us: u32,
    pub segment_min_ms: u32,
    pub segment_max_ms: u32,
    pub conditions: Vec<ConditionView>,
    pub battery_fade_milli: u16,
    pub length_mult_milli: Vec<u16>,
    pub score_floor_milli: u16,
    pub noise_straight_milli: u16,
    pub noise_turn_milli: u16,
}

#[near(serializers = [json])]
pub struct EconomyConstants {
    pub starter_volts: U128,
    pub starter_skin_template: u16,
    pub active_slots: Vec<(u8, u32)>,
    pub skin_drop_bp: Vec<u16>,
    pub skin_supply_cap: Vec<u32>,
    pub skin_tier_renders: Vec<(u16, u8)>,
    pub market_rake_bp: U128,
    pub market_min_price: U128,
    pub packs: Vec<PackTierView>,
    pub team_count: u8,
    pub team_drone_levels: Vec<u8>,
    pub team_bound_skins: u8,
    pub team_bound_mods: u8,
    pub team_start_volts: U128,
    pub team_per_tx_cap: U128,
    pub team_per_day_cap: U128,
    pub team_reserve: U128,
}

#[near(serializers = [json])]
pub struct Constants {
    pub stat_names: Vec<String>,
    pub rarity_names: Vec<String>,
    pub drones: DroneConstants,
    pub races: RaceConstants,
    pub engine: EngineConstants,
    pub economy: EconomyConstants,
    pub mods: Vec<ModTemplateView>,
    pub skins: Vec<SkinTemplateView>,
    pub tracks: Vec<TrackView>,
    pub elo_pow10: Vec<u64>,
    pub elo_pow10_step: u32,
}

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

impl Constants {
    pub fn build() -> Self {
        Self {
            stat_names: strings(&STAT_NAMES),
            rarity_names: strings(&RARITY_NAMES),
            drones: DroneConstants {
                stat_min: STAT_MIN,
                stat_max: STAT_MAX,
                tsb_base: TSB_BASE,
                tsb_per_level: TSB_PER_LEVEL,
                cap_base: CAP_BASE,
                cap_per_level_tenths: CAP_PER_LEVEL_TENTHS,
                level_cap: LEVEL_CAP,
                xp_per_level_squared: XP_PER_LEVEL_SQUARED,
                xp_win: XP_WIN,
                xp_loss: XP_LOSS,
                level_up_volts: U128(LEVEL_UP_VOLTS),
                start_elo: START_ELO,
                elo_k: ELO_K,
                tier_levels: TIER_LEVELS,
                vendor_price: U128(VENDOR_DRONE_PRICE),
                vendor_stat_roll_max: VENDOR_STAT_ROLL_MAX,
                milestone_drones: MILESTONE_DRONES.to_vec(),
            },
            races: RaceConstants {
                cadence_s: CADENCE_S,
                strategy_window_ms: STRATEGY_WINDOW_MS,
                brackets: BRACKETS
                    .iter()
                    .map(|(l, a, b)| (l.to_string(), *a, *b))
                    .collect(),
                bot_bracket_fill: BOT_BRACKET_FILL,
                weather: strings(&WEATHER),
                time_of_day: strings(&TIME_OF_DAY),
                winner_payout_base: U128(WINNER_PAYOUT_BASE),
                winner_level_divisor: U128(WINNER_LEVEL_DIVISOR),
                winner_difficulty_divisor: U128(WINNER_DIFFICULTY_DIVISOR),
                winner_elo_gap_divisor: U128(WINNER_ELO_GAP_DIVISOR),
                dominance: DOMINANCE.iter().map(|(m, v)| (*m, U128(*v))).collect(),
                loser_payout_base: U128(LOSER_PAYOUT_BASE),
                loser_level_divisor: U128(LOSER_LEVEL_DIVISOR),
            },
            engine: EngineConstants {
                laps: ENGINE_LAPS,
                run_min: ENGINE_RUN_MIN,
                run_max: ENGINE_RUN_MAX,
                subtypes: SUBTYPES
                    .iter()
                    .map(|s| SubtypeView {
                        name: s.name.to_string(),
                        is_turn: s.is_turn,
                        mult_milli: s.mult_milli,
                        weights_milli: s.weights_milli.to_vec(),
                    })
                    .collect(),
                jitter_milli: ENGINE_JITTER_MILLI,
                straight_base_ms: ENGINE_STRAIGHT_BASE_MS,
                straight_per_difficulty_ms: ENGINE_STRAIGHT_PER_DIFFICULTY_MS,
                turn_base_ms: ENGINE_TURN_BASE_MS,
                turn_per_difficulty_ms: ENGINE_TURN_PER_DIFFICULTY_MS,
                score_coef_us: ENGINE_SCORE_COEF_US,
                segment_min_ms: ENGINE_SEGMENT_MIN_MS,
                segment_max_ms: ENGINE_SEGMENT_MAX_MS,
                conditions: CONDITIONS
                    .iter()
                    .map(|c| ConditionView {
                        when: c.when.to_string(),
                        stat: c.stat,
                        divisor: c.divisor,
                        min_milli: c.min_milli,
                        max_milli: c.max_milli,
                    })
                    .collect(),
                battery_fade_milli: ENGINE_BATTERY_FADE_MILLI,
                length_mult_milli: ENGINE_LENGTH_MULT_MILLI.to_vec(),
                score_floor_milli: ENGINE_SCORE_FLOOR_MILLI,
                noise_straight_milli: ENGINE_NOISE_STRAIGHT_MILLI,
                noise_turn_milli: ENGINE_NOISE_TURN_MILLI,
            },
            economy: EconomyConstants {
                starter_volts: U128(STARTER_VOLTS),
                starter_skin_template: STARTER_SKIN_TEMPLATE,
                active_slots: ACTIVE_SLOTS.to_vec(),
                skin_drop_bp: SKIN_DROP_BP.to_vec(),
                skin_supply_cap: SKIN_SUPPLY_CAP.to_vec(),
                skin_tier_renders: SKIN_TIER_RENDERS.to_vec(),
                market_rake_bp: U128(MARKET_RAKE_BP),
                market_min_price: U128(MARKET_MIN_PRICE),
                packs: PACK_TIERS
                    .iter()
                    .map(|p| PackTierView {
                        id: p.id,
                        name: p.name.to_string(),
                        skin_pack_price: U128(p.skin_pack_price),
                        mod_capsule_price: U128(p.mod_capsule_price),
                        slot1: p.slot1.to_vec(),
                        slots23: p.slots23.to_vec(),
                    })
                    .collect(),
                team_count: TEAM_COUNT,
                team_drone_levels: TEAM_DRONE_LEVELS.to_vec(),
                team_bound_skins: TEAM_BOUND_SKINS,
                team_bound_mods: TEAM_BOUND_MODS,
                team_start_volts: U128(TEAM_START_VOLTS),
                team_per_tx_cap: U128(TEAM_PER_TX_CAP),
                team_per_day_cap: U128(TEAM_PER_DAY_CAP),
                team_reserve: U128(TEAM_RESERVE),
            },
            mods: MODS.iter().map(ModTemplateView::from).collect(),
            skins: SKINS
                .iter()
                .map(|t| SkinTemplateView {
                    id: t.id,
                    slug: t.slug.to_string(),
                    file: t.file.to_string(),
                    rarity: t.rarity,
                })
                .collect(),
            tracks: TRACKS
                .iter()
                .map(|t| TrackView {
                    id: t.id,
                    name: t.name.to_string(),
                    min_level: t.min_level,
                    max_level: t.max_level,
                    difficulty: t.difficulty,
                    straights: t.straights,
                    turns: t.turns,
                    length: LENGTH_NAMES[usize::from(t.length)].to_string(),
                    has_art: t.has_art,
                })
                .collect(),
            elo_pow10: POW10.to_vec(),
            elo_pow10_step: POW10_STEP,
        }
    }
}
