//! Values derived from sha256: the drone state hash settlement checks, pack reveal draws and
//! vendor drone rolls (SPEC.md 4.4). Pure apart from the sha256 host function.

use near_sdk::env;

use crate::constants::{
    ODDS_SCALE_BP, PACK_NAME_OFFSET, PACK_PICK_OFFSET, PACK_ROLL_OFFSET, STAT_MIN,
    VENDOR_STAT_ROLL_MAX,
};
use crate::math::{stat_sum, tsb};

/// sha256(9 stat bytes ++ u16 LE mod template ++ u16 LE skin template); 0 is an empty slot.
pub fn stats_hash_bytes(stats: &[u8; 9], mod_template: u16, skin_template: u16) -> [u8; 32] {
    let mut bytes = [0u8; 13];
    bytes[..9].copy_from_slice(stats);
    bytes[9..11].copy_from_slice(&mod_template.to_le_bytes());
    bytes[11..].copy_from_slice(&skin_template.to_le_bytes());
    env::sha256_array(bytes)
}

fn u32_at(bytes: &[u8; 32], offset: usize) -> u32 {
    let mut b = [0u8; 4];
    b.copy_from_slice(&bytes[offset..offset + 4]);
    u32::from_le_bytes(b)
}

fn u16_at(bytes: &[u8; 32], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

/// The reveal result: sha256(secret ++ chain random seed ++ pack_id LE).
pub fn pack_result(secret: &[u8; 32], random_seed: &[u8], pack_id: u64) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(32 + random_seed.len() + 8);
    bytes.extend_from_slice(secret);
    bytes.extend_from_slice(random_seed);
    bytes.extend_from_slice(&pack_id.to_le_bytes());
    env::sha256_array(bytes)
}

/// The three draws of pack slot `i` (0-2) from the reveal result.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SlotDraw {
    /// Rarity roll; r = roll / 2^32.
    pub roll: u32,
    /// Template index among the candidates: pick % candidates.
    pub pick: u32,
    /// Placeholder name index: name % pool length.
    pub name: u16,
}

pub fn slot_draw(result: &[u8; 32], i: usize) -> SlotDraw {
    SlotDraw {
        roll: u32_at(result, PACK_ROLL_OFFSET + 4 * i),
        pick: u32_at(result, PACK_PICK_OFFSET + 4 * i),
        name: u16_at(result, PACK_NAME_OFFSET + 2 * i),
    }
}

/// Rarity for r = roll / 2^32 against (rarity, bp) odds taken cumulatively in order: the first
/// entry whose cumulative bp exceeds floor(r * 10,000). Exact: r < c / 10,000 for integer c.
pub fn roll_rarity(odds: &[(u8, u16)], roll: u32) -> u8 {
    let bp = (u64::from(roll) * ODDS_SCALE_BP) >> 32;
    let mut cumulative = 0u64;
    for &(rarity, p) in odds {
        cumulative += u64::from(p);
        if bp < cumulative {
            return rarity;
        }
    }
    odds.last().map_or(0, |&(rarity, _)| rarity)
}

/// `index % len` as a usize, for picking from a non-empty list.
pub fn pick_index(index: u32, len: usize) -> usize {
    usize::try_from(index).unwrap_or(0) % len.max(1)
}

/// An endless stream of u32 values: block k is sha256(seed ++ k as u32 LE), read 4 bytes at a time.
pub struct HashStream {
    seed: [u8; 32],
    block: [u8; 32],
    counter: u32,
    offset: usize,
}

impl HashStream {
    pub fn new(seed: [u8; 32]) -> Self {
        let mut s = Self {
            seed,
            block: [0; 32],
            counter: 0,
            offset: 32,
        };
        s.refill();
        s
    }

    fn refill(&mut self) {
        let mut bytes = [0u8; 36];
        bytes[..32].copy_from_slice(&self.seed);
        bytes[32..].copy_from_slice(&self.counter.to_le_bytes());
        self.block = env::sha256_array(bytes);
        self.counter = self.counter.wrapping_add(1);
        self.offset = 0;
    }

    pub fn next_u32(&mut self) -> u32 {
        if self.offset + 4 > 32 {
            self.refill();
        }
        let v = u32_at(&self.block, self.offset);
        self.offset += 4;
        v
    }
}

/// Everything a vendor drone needs from its seed, drawn in this order: 9 stat rolls, one draw per
/// lowering step, skin pick, mod pick, placeholder name pick, name word, letter, digit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VendorRoll {
    pub stats: [u8; 9],
    pub skin_pick: u32,
    pub mod_pick: u32,
    pub placeholder_pick: u32,
    pub word: u32,
    pub letter: u32,
    pub digit: u32,
}

/// Vendor seed: sha256(chain random seed ++ new drone token id as UTF-8).
pub fn vendor_seed(random_seed: &[u8], token_id: &str) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(random_seed.len() + token_id.len());
    bytes.extend_from_slice(random_seed);
    bytes.extend_from_slice(token_id.as_bytes());
    env::sha256_array(bytes)
}

/// SPEC.md 2.1 vendor drone: each stat 1 + (u32 % 5), then while the sum exceeds TSB(level), one
/// stat chosen uniformly among those above 1 drops by 1. The loop runs exactly
/// max(0, sum - TSB) times.
pub fn vendor_roll(seed: [u8; 32], level: u8) -> VendorRoll {
    let mut stream = HashStream::new(seed);
    let mut stats = [STAT_MIN; 9];
    for s in &mut stats {
        let roll = u8::try_from(stream.next_u32() % u32::from(VENDOR_STAT_ROLL_MAX)).unwrap_or(0);
        *s = STAT_MIN + roll;
    }
    let excess = stat_sum(&stats).saturating_sub(tsb(level));
    for _ in 0..excess {
        let reducible: Vec<usize> = (0..9).filter(|&i| stats[i] > STAT_MIN).collect();
        if reducible.is_empty() {
            break;
        }
        let i = reducible[pick_index(stream.next_u32(), reducible.len())];
        stats[i] -= 1;
    }
    VendorRoll {
        stats,
        skin_pick: stream.next_u32(),
        mod_pick: stream.next_u32(),
        placeholder_pick: stream.next_u32(),
        word: stream.next_u32(),
        letter: stream.next_u32(),
        digit: stream.next_u32(),
    }
}
