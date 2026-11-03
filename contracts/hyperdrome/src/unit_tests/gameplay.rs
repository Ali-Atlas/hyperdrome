use near_sdk::serde_json::{self, Value};

use crate::constants::names::{DRONE_NAME_WORDS, PLACEHOLDER_SKIN_NAMES};
use crate::constants::tables::PACK_TIERS;
use crate::constants::{COMMON, EPIC, LEGENDARY, RARE};
use crate::hashing::{
    HashStream, SlotDraw, pick_index, roll_rarity, slot_draw, stats_hash_bytes, vendor_roll,
    vendor_seed,
};
use crate::math::{is_locked_at, stat_sum};
use crate::packs::vendor_name;

/// Shared with the engine (T4) and the adapter (T7): repo-root `tests/golden/stats-hash.json`.
const GOLDEN_STATS_HASH: &str = include_str!("../../../../tests/golden/stats-hash.json");

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn stats_hash_matches_golden_vectors() {
    let vectors: Vec<Value> = serde_json::from_str(GOLDEN_STATS_HASH).unwrap_or_default();
    assert!(vectors.len() >= 4, "at least 4 golden vectors");
    for v in &vectors {
        let stats: [u8; 9] = serde_json::from_value(v["stats"].clone()).unwrap_or_default();
        let m = u16::try_from(v["modTemplate"].as_u64().unwrap_or(u64::MAX)).unwrap_or(0);
        let s = u16::try_from(v["skinTemplate"].as_u64().unwrap_or(u64::MAX)).unwrap_or(0);
        assert_eq!(
            hex(&stats_hash_bytes(&stats, m, s)),
            v["hash"].as_str().unwrap_or_default(),
            "{v}"
        );
    }
    assert!(
        vectors
            .iter()
            .any(|v| v["modTemplate"] == 0 && v["skinTemplate"] == 0),
        "a vector with both slots empty"
    );
}

#[test]
fn lock_boundary_is_120_seconds_after_commit() {
    let committed = 1_700_000_000_000;
    assert!(!is_locked_at(committed, committed));
    assert!(!is_locked_at(committed, committed + 119_999));
    assert!(is_locked_at(committed, committed + 120_000));
    assert!(is_locked_at(committed, committed + 500_000));
    assert!(!is_locked_at(u64::MAX - 10, u64::MAX - 1), "no overflow");
}

#[test]
fn rarity_roll_is_cumulative_in_listed_order() {
    let starter = PACK_TIERS[0].slots23; // common 80%, rare 17%, epic 2.5%, legendary 0.5%
    // floor(r * 10,000) for r = roll / 2^32 crosses 8,000 between these two rolls.
    let last_common = 3_435_973_836;
    assert_eq!(roll_rarity(starter, 0), COMMON);
    assert_eq!(roll_rarity(starter, last_common), COMMON);
    assert_eq!(roll_rarity(starter, last_common + 1), RARE);
    assert_eq!(roll_rarity(starter, u32::MAX), LEGENDARY);
    // 99.5% boundary: bp 9,949 epic, 9,950 legendary.
    assert_eq!(roll_rarity(starter, 4_273_492_459), EPIC);
    assert_eq!(roll_rarity(starter, 4_273_492_460), LEGENDARY);

    let legendary_slot1 = PACK_TIERS[2].slot1; // legendary 45%, epic 55%
    assert_eq!(roll_rarity(legendary_slot1, 0), LEGENDARY);
    assert_eq!(roll_rarity(legendary_slot1, u32::MAX), EPIC);
    assert_eq!(roll_rarity(PACK_TIERS[1].slot1, u32::MAX), RARE);
}

#[test]
fn slot_draws_follow_the_byte_map() {
    let result: [u8; 32] = core::array::from_fn(|i| u8::try_from(i).unwrap_or(0));
    assert_eq!(
        slot_draw(&result, 0),
        SlotDraw {
            roll: u32::from_le_bytes([0, 1, 2, 3]),
            pick: u32::from_le_bytes([12, 13, 14, 15]),
            name: u16::from_le_bytes([24, 25]),
        }
    );
    assert_eq!(
        slot_draw(&result, 2),
        SlotDraw {
            roll: u32::from_le_bytes([8, 9, 10, 11]),
            pick: u32::from_le_bytes([20, 21, 22, 23]),
            name: u16::from_le_bytes([28, 29]),
        }
    );
}

#[test]
fn pick_index_stays_in_range() {
    assert_eq!(pick_index(17, 8), 1);
    assert_eq!(pick_index(u32::MAX, 3), 0);
    assert_eq!(pick_index(5, 0), 0, "no division by zero");
}

#[test]
fn hash_stream_is_deterministic_and_rehashes() {
    let mut a = HashStream::new([7; 32]);
    let mut b = HashStream::new([7; 32]);
    let xs: Vec<u32> = (0..20).map(|_| a.next_u32()).collect();
    let ys: Vec<u32> = (0..20).map(|_| b.next_u32()).collect();
    assert_eq!(xs, ys);
    assert_ne!(xs[..8], xs[8..16], "second block differs from the first");
}

#[test]
fn vendor_stats_roll_1_to_5_and_fit_tsb_1() {
    for n in 0..500u32 {
        let seed = vendor_seed(&n.to_le_bytes(), &format!("d:{n}"));
        let roll = vendor_roll(seed, 1);
        assert!(roll.stats.iter().all(|s| (1..=5).contains(s)), "{roll:?}");
        assert!(stat_sum(&roll.stats) <= 29, "{roll:?}");
        assert_eq!(roll, vendor_roll(seed, 1), "deterministic");
    }
    let seed_a = vendor_seed(&[1; 32], "d:1");
    let seed_b = vendor_seed(&[1; 32], "d:2");
    assert_ne!(seed_a, seed_b, "same block, different token id");
}

#[test]
fn vendor_trim_stops_exactly_at_tsb() {
    // Find seeds whose raw rolls exceed 29 and check the trim lands on exactly 29.
    let mut trimmed = 0;
    for n in 0..200u32 {
        let seed = vendor_seed(&n.to_le_bytes(), "d:1");
        let mut stream = HashStream::new(seed);
        let raw: u32 = (0..9).map(|_| 1 + stream.next_u32() % 5).sum();
        let sum = stat_sum(&vendor_roll(seed, 1).stats);
        assert_eq!(sum, raw.min(29), "seed {n}");
        trimmed += u32::from(raw > 29);
    }
    assert!(trimmed > 0, "the sample includes trimmed drones");
}

#[test]
fn vendor_name_uses_the_baseline_pattern() {
    let roll = vendor_roll(vendor_seed(&[9; 32], "d:5"), 1);
    let name = vendor_name(&roll);
    let (word, tag) = name.split_once('-').unwrap_or_default();
    assert!(DRONE_NAME_WORDS.contains(&word), "{name}");
    let tag = tag.as_bytes();
    assert_eq!(tag.len(), 2, "{name}");
    assert!(
        tag[0].is_ascii_uppercase() && tag[1].is_ascii_digit(),
        "{name}"
    );
}

#[test]
fn name_pools_match_the_baseline_sizes() {
    assert_eq!(DRONE_NAME_WORDS.len(), 171);
    assert_eq!(PLACEHOLDER_SKIN_NAMES.map(<[&str]>::len), [30, 24, 14, 4]);
}
