//! On-chain record types (SPEC.md 4.2). Every record that may change shape later is wrapped in a
//! single-variant versioned enum so a new variant can be added without a bulk migration.

use std::borrow::Cow;

use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::{AccountId, BorshStorageKey, near};

/// Storage prefixes. Order is part of the storage layout: append only.
#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
pub enum StorageKey {
    Volts,
    VoltsMeta,
    NftOwners,
    NftEnumeration,
    NftApprovals,
    NftMeta,
    Players,
    DronesHot,
    DronesCold,
    Items,
    Listings,
    ActiveListings,
    Batches,
    Packs,
    Teams,
    SkinMinted,
}

/// Kind of a non-drone token.
#[near(serializers = [borsh, json])]
#[serde(rename_all = "lowercase")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ItemKind {
    Skin,
    Mod,
}

/// A registered player or AI team.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Player {
    pub seq: u64,
    pub created_at_ms: u64,
    pub is_team: bool,
}

#[near(serializers = [borsh])]
pub enum VersionedPlayer {
    V1(Player),
}

/// Per-drone fields rewritten by settlement.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DroneHot {
    pub level: u8,
    pub xp: u32,
    pub elo: i32,
    pub wins: u32,
    pub losses: u32,
    pub equipped_mod: Option<TokenId>,
    pub equipped_skin: Option<TokenId>,
    pub in_batch: Option<u64>,
}

#[near(serializers = [borsh])]
pub enum VersionedDroneHot {
    V1(DroneHot),
}

/// Per-drone fields that change only on player actions.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DroneCold {
    /// The 9 stats in SPEC.md 2.1 order.
    pub stats: [u8; 9],
    pub bound_skins: Vec<TokenId>,
    pub bound_mods: Vec<TokenId>,
    pub invested: u64,
    pub name: String,
}

#[near(serializers = [borsh])]
pub enum VersionedDroneCold {
    V1(DroneCold),
}

/// A skin or a mod.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
    pub kind: ItemKind,
    /// 1-based template id (SPEC.md 2.5 and 2.6 order).
    pub template: u16,
    pub rarity: u8,
    pub bound_to: Option<TokenId>,
    pub placeholder_name: Option<String>,
}

#[near(serializers = [borsh])]
pub enum VersionedItem {
    V1(Item),
}

/// An escrowed marketplace listing (T5).
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Listing {
    pub seller: AccountId,
    pub price: u128,
    pub listed_at_ms: u64,
}

/// One race in a committed batch.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Matchup {
    pub a: TokenId,
    pub b: TokenId,
    pub track: u8,
    pub weather: u8,
    pub tod: u8,
}

/// A committed race batch (current layout, `VersionedBatch::V2`).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Batch {
    pub seed_hash: [u8; 32],
    pub committed_at_ms: u64,
    /// The races, in order; emptied when the final chunk settles or the batch is aborted, so the
    /// storage stake is refunded.
    pub matchups: Vec<Matchup>,
    pub settled: bool,
    /// Races settled so far, from index 0; `settled` once it equals the matchup count.
    pub settled_count: u32,
    /// Set by `abort_batch`: the batch pays nothing and can no longer be settled.
    pub aborted: bool,
}

/// The T6 batch layout (`VersionedBatch::V1`): `Batch` without `aborted`. Read-only; a V1 record
/// becomes V2 when it is next read.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct BatchV1 {
    pub seed_hash: [u8; 32],
    pub committed_at_ms: u64,
    pub matchups: Vec<Matchup>,
    pub settled: bool,
    pub settled_count: u32,
}

impl From<BatchV1> for Batch {
    fn from(b: BatchV1) -> Self {
        Self {
            seed_hash: b.seed_hash,
            committed_at_ms: b.committed_at_ms,
            matchups: b.matchups,
            settled: b.settled,
            settled_count: b.settled_count,
            aborted: false,
        }
    }
}

#[near(serializers = [borsh])]
pub enum VersionedBatch {
    V1(BatchV1),
    V2(Batch),
}

impl VersionedBatch {
    /// The batch in the current layout: borrowed for V2, converted for V1.
    pub fn current(&self) -> Cow<'_, Batch> {
        match self {
            Self::V1(b) => Cow::Owned(b.clone().into()),
            Self::V2(b) => Cow::Borrowed(b),
        }
    }

    /// Rewrites a V1 record as V2 in place and returns the batch for mutation.
    pub fn upgrade(&mut self) -> &mut Batch {
        if let Self::V1(b) = self {
            *self = Self::V2(b.clone().into());
        }
        match self {
            Self::V2(b) => b,
            Self::V1(_) => unreachable!("upgraded above"),
        }
    }
}

/// A committed pack or capsule open (T5).
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct PackCommit {
    pub buyer: AccountId,
    pub kind: ItemKind,
    pub tier: u8,
    pub hash: [u8; 32],
    pub height: u64,
    pub revealed: bool,
}

/// On-chain spend caps for an AI team, in Volts.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct TeamBudget {
    pub per_tx: u128,
    pub per_day: u128,
    pub spent: u128,
    pub day: u32,
}

/// One race result submitted to `settle_batch`.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct RaceResult {
    pub a: TokenId,
    pub b: TokenId,
    pub winner: TokenId,
    pub time_a_ms: u32,
    pub time_b_ms: u32,
    pub stats_hash_a: [u8; 32],
    pub stats_hash_b: [u8; 32],
}
