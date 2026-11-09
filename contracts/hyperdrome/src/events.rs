//! Custom events (NEP-297, standard `hyperdrome`, version 1.0.0; SPEC.md 4.7). Standard nep141
//! and nep171 events come from near-contract-standards.

use near_sdk::json_types::U128;
use near_sdk::{AccountId, near};

use crate::types::ItemKind;

/// One race in a `batch_settled` event: `i` is the race's index in the batch, `va`/`vb` the Volts
/// minted for each drone in this race (payout plus level-up Volts, 0 with no beneficiary), and
/// `elo`, `xp`, `lvl` each drone's values after the race.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SettledRace {
    pub i: u32,
    pub a: String,
    pub b: String,
    pub winner: String,
    pub ta: u32,
    pub tb: u32,
    pub va: U128,
    pub vb: U128,
    pub elo_a: i32,
    pub elo_b: i32,
    pub xp_a: u32,
    pub xp_b: u32,
    pub lvl_a: u8,
    pub lvl_b: u8,
}

#[near(event_json(standard = "hyperdrome"))]
pub enum Event {
    #[event_version("1.0.0")]
    DroneMinted {
        token: String,
        owner: AccountId,
        level: u8,
    },
    #[event_version("1.0.0")]
    ItemMinted {
        token: String,
        owner: AccountId,
        kind: ItemKind,
        template: u16,
        rarity: u8,
    },
    #[event_version("1.0.0")]
    StatsAllocated {
        drone: String,
        stats: [u8; 9],
        cost: u64,
    },
    #[event_version("1.0.0")]
    Equipped {
        drone: String,
        kind: ItemKind,
        item: Option<String>,
    },
    #[event_version("1.0.0")]
    ItemBound { drone: String, item: String },
    #[event_version("1.0.0")]
    Listed {
        token: String,
        seller: AccountId,
        price: U128,
    },
    #[event_version("1.0.0")]
    Sold {
        token: String,
        seller: AccountId,
        buyer: AccountId,
        price: U128,
        fee: U128,
    },
    #[event_version("1.0.0")]
    Cancelled { token: String },
    #[event_version("1.0.0")]
    PackCommitted {
        pack_id: u64,
        buyer: AccountId,
        kind: ItemKind,
        tier: u8,
    },
    #[event_version("1.0.0")]
    PackOpened { pack_id: u64, tokens: Vec<String> },
    #[event_version("1.0.0")]
    WalletLinked {
        player: AccountId,
        wallet: AccountId,
    },
    #[event_version("1.0.0")]
    WalletUnlinked {
        player: AccountId,
        wallet: AccountId,
    },
    #[event_version("1.0.0")]
    Withdrawn {
        player: AccountId,
        wallet: AccountId,
        tokens: Vec<String>,
        volts: U128,
    },
    #[event_version("1.0.0")]
    BatchCommitted { batch_id: u64, count: u32 },
    #[event_version("1.0.0")]
    BatchAborted { batch_id: u64, count: u32 },
    #[event_version("1.0.0")]
    BatchSettled {
        batch_id: u64,
        races: Vec<SettledRace>,
    },
}
