//! Tracks, packs, engine and ELO tables (SPEC.md 2.3, 2.4, 2.7, 2.9 and 4.6). Fractions are fixed
//! point: `_milli` is parts per thousand, `_bp` is basis points (parts per ten thousand).

use super::catalog::{
    ACCELERATION, DURABILITY, NIGHT_VISION, RAIN_HANDLING, SPEED, TURNING, WIND_RESISTANCE,
};
use super::{COMMON, EPIC, LEGENDARY, RARE};

pub const LENGTH_SHORT: u8 = 0;
pub const LENGTH_MEDIUM: u8 = 1;
pub const LENGTH_LONG: u8 = 2;
pub const LENGTH_NAMES: [&str; 3] = ["short", "medium", "long"];

pub struct Track {
    pub id: u8,
    pub name: &'static str,
    pub min_level: u8,
    pub max_level: u8,
    pub difficulty: u8,
    pub straights: u8,
    pub turns: u8,
    pub length: u8,
    pub has_art: bool,
}

const fn track(
    id: u8,
    name: &'static str,
    levels: (u8, u8),
    d: u8,
    st: (u8, u8),
    length: u8,
    art: bool,
) -> Track {
    Track {
        id,
        name,
        min_level: levels.0,
        max_level: levels.1,
        difficulty: d,
        straights: st.0,
        turns: st.1,
        length,
        has_art: art,
    }
}

/// SPEC.md 2.9. Level 20+ uses the 16-20 set.
pub const TRACKS: [Track; 16] = [
    track(0, "Horizon Express", (1, 5), 1, (2, 2), LENGTH_SHORT, true),
    track(
        1,
        "Neon Straightaway",
        (1, 5),
        2,
        (3, 3),
        LENGTH_MEDIUM,
        true,
    ),
    track(2, "Keyhole", (1, 5), 2, (2, 2), LENGTH_SHORT, true),
    track(3, "The Grid", (1, 5), 3, (4, 4), LENGTH_MEDIUM, true),
    track(4, "Meridian", (6, 10), 3, (4, 4), LENGTH_MEDIUM, true),
    track(5, "Circuit Alpha", (6, 10), 4, (4, 5), LENGTH_MEDIUM, true),
    track(6, "Crossfire", (6, 10), 4, (3, 5), LENGTH_MEDIUM, false),
    track(7, "Iron Ribbon", (6, 10), 5, (4, 6), LENGTH_LONG, false),
    track(8, "Skyline Drift", (11, 15), 6, (3, 7), LENGTH_LONG, true),
    track(9, "Helix", (11, 15), 6, (2, 6), LENGTH_MEDIUM, false),
    track(10, "Switchblade", (11, 15), 7, (3, 8), LENGTH_LONG, false),
    track(
        11,
        "Phantom Circuit",
        (11, 15),
        7,
        (4, 7),
        LENGTH_LONG,
        false,
    ),
    track(12, "Voltage Loop", (16, 20), 8, (4, 8), LENGTH_LONG, true),
    track(13, "Obsidian Maze", (16, 20), 9, (3, 9), LENGTH_LONG, false),
    track(14, "Apex Descent", (16, 20), 9, (2, 10), LENGTH_LONG, false),
    track(15, "Tempest Run", (16, 20), 10, (2, 8), LENGTH_LONG, true),
];

pub const WEATHER: [&str; 7] = [
    "clear",
    "clouds",
    "rain",
    "heavy_rain",
    "wind",
    "haze",
    "fog",
];
pub const TIME_OF_DAY: [&str; 4] = ["dawn", "day", "dusk", "night"];

/// Brackets as (label, min level, max level). "20+" covers levels above 20.
pub const BRACKETS: [(&str, u8, u8); 5] = [
    ("1-5", 1, 5),
    ("6-10", 6, 10),
    ("11-15", 11, 15),
    ("16-20", 16, 20),
    ("20+", 21, u8::MAX),
];

/// A pack or capsule tier (SPEC.md 2.7). Odds are (rarity, bp) pairs, rolled cumulatively in the
/// listed order.
pub struct PackTier {
    pub id: u8,
    pub name: &'static str,
    pub skin_pack_price: u128,
    pub mod_capsule_price: u128,
    pub slot1: &'static [(u8, u16)],
    pub slots23: &'static [(u8, u16)],
}

pub const PACK_TIERS: [PackTier; 3] = [
    PackTier {
        id: 0,
        name: "starter",
        skin_pack_price: 2_000,
        mod_capsule_price: 1_000,
        slot1: &[(COMMON, 10_000)],
        slots23: &[(COMMON, 8_000), (RARE, 1_700), (EPIC, 250), (LEGENDARY, 50)],
    },
    PackTier {
        id: 1,
        name: "premium",
        skin_pack_price: 12_000,
        mod_capsule_price: 6_000,
        slot1: &[(RARE, 10_000)],
        slots23: &[
            (COMMON, 4_000),
            (RARE, 3_500),
            (EPIC, 2_000),
            (LEGENDARY, 500),
        ],
    },
    PackTier {
        id: 2,
        name: "legendary",
        skin_pack_price: 60_000,
        mod_capsule_price: 30_000,
        slot1: &[(LEGENDARY, 4_500), (EPIC, 5_500)],
        slots23: &[(RARE, 5_500), (EPIC, 4_000), (LEGENDARY, 500)],
    },
];

/// Engine segment subtype (SPEC.md 2.4): multiplier and stat weights, both in milli.
pub struct Subtype {
    pub name: &'static str,
    pub is_turn: bool,
    pub mult_milli: u16,
    pub weights_milli: &'static [(u8, u16)],
}

pub const SUBTYPES: [Subtype; 7] = [
    Subtype {
        name: "short_burst",
        is_turn: false,
        mult_milli: 600,
        weights_milli: &[(ACCELERATION, 500), (SPEED, 300), (WIND_RESISTANCE, 200)],
    },
    Subtype {
        name: "standard_str",
        is_turn: false,
        mult_milli: 1_000,
        weights_milli: &[(SPEED, 500), (ACCELERATION, 300), (WIND_RESISTANCE, 200)],
    },
    Subtype {
        name: "long_straight",
        is_turn: false,
        mult_milli: 1_400,
        weights_milli: &[(SPEED, 600), (ACCELERATION, 200), (WIND_RESISTANCE, 200)],
    },
    Subtype {
        name: "gentle_curve",
        is_turn: true,
        mult_milli: 700,
        weights_milli: &[(TURNING, 400), (ACCELERATION, 300), (DURABILITY, 300)],
    },
    Subtype {
        name: "standard_turn",
        is_turn: true,
        mult_milli: 1_000,
        weights_milli: &[(TURNING, 500), (DURABILITY, 300), (ACCELERATION, 200)],
    },
    Subtype {
        name: "sharp_hairpin",
        is_turn: true,
        mult_milli: 1_300,
        weights_milli: &[(TURNING, 600), (DURABILITY, 300), (ACCELERATION, 100)],
    },
    Subtype {
        name: "chicane",
        is_turn: true,
        mult_milli: 900,
        weights_milli: &[(ACCELERATION, 400), (TURNING, 400), (DURABILITY, 200)],
    },
];

/// Condition multiplier on score: clamp(stat / divisor, min, max). `when` is a weather or a time
/// of day name.
pub struct Condition {
    pub when: &'static str,
    pub stat: u8,
    pub divisor: u8,
    pub min_milli: u16,
    pub max_milli: u16,
}

pub const CONDITIONS: [Condition; 6] = [
    Condition {
        when: "night",
        stat: NIGHT_VISION,
        divisor: 50,
        min_milli: 500,
        max_milli: 1_500,
    },
    Condition {
        when: "rain",
        stat: RAIN_HANDLING,
        divisor: 50,
        min_milli: 500,
        max_milli: 1_500,
    },
    Condition {
        when: "heavy_rain",
        stat: RAIN_HANDLING,
        divisor: 60,
        min_milli: 400,
        max_milli: 1_400,
    },
    Condition {
        when: "wind",
        stat: WIND_RESISTANCE,
        divisor: 50,
        min_milli: 500,
        max_milli: 1_500,
    },
    Condition {
        when: "fog",
        stat: NIGHT_VISION,
        divisor: 60,
        min_milli: 600,
        max_milli: 1_400,
    },
    Condition {
        when: "haze",
        stat: NIGHT_VISION,
        divisor: 70,
        min_milli: 700,
        max_milli: 1_300,
    },
];

/// Engine scalars (SPEC.md 2.4), in milli unless named otherwise.
pub const ENGINE_LAPS: u8 = 3;
pub const ENGINE_RUN_MIN: u8 = 2;
pub const ENGINE_RUN_MAX: u8 = 4;
pub const ENGINE_JITTER_MILLI: u16 = 60;
pub const ENGINE_STRAIGHT_BASE_MS: u32 = 1_000;
pub const ENGINE_STRAIGHT_PER_DIFFICULTY_MS: u32 = 200;
pub const ENGINE_TURN_BASE_MS: u32 = 1_800;
pub const ENGINE_TURN_PER_DIFFICULTY_MS: u32 = 400;
/// Seconds of segment time removed per score point, in micro-seconds (0.007 s).
pub const ENGINE_SCORE_COEF_US: u32 = 7_000;
pub const ENGINE_SEGMENT_MIN_MS: u32 = 800;
pub const ENGINE_SEGMENT_MAX_MS: u32 = 8_000;
pub const ENGINE_BATTERY_FADE_MILLI: u16 = 850;
/// Battery fade length multiplier by track length (short, medium, long).
pub const ENGINE_LENGTH_MULT_MILLI: [u16; 3] = [800, 1_000, 1_200];
pub const ENGINE_SCORE_FLOOR_MILLI: u16 = 100;
pub const ENGINE_NOISE_STRAIGHT_MILLI: u16 = 30;
pub const ENGINE_NOISE_TURN_MILLI: u16 = 60;

/// round(10^(k/400) * 1e6) for k = 0..800 step 25 (SPEC.md 4.6).
pub const POW10: [u64; 33] = [
    1_000_000,
    1_154_782,
    1_333_521,
    1_539_927,
    1_778_279,
    2_053_525,
    2_371_374,
    2_738_420,
    3_162_278,
    3_651_741,
    4_216_965,
    4_869_675,
    5_623_413,
    6_493_816,
    7_498_942,
    8_659_643,
    10_000_000,
    11_547_820,
    13_335_214,
    15_399_265,
    17_782_794,
    20_535_250,
    23_713_737,
    27_384_196,
    31_622_777,
    36_517_413,
    42_169_650,
    48_696_753,
    56_234_133,
    64_938_163,
    74_989_421,
    86_596_432,
    100_000_000,
];
pub const POW10_STEP: u32 = 25;
pub const ELO_DIFF_CLAMP: i32 = 800;
pub const ELO_SCALE: u64 = 1_000_000;
