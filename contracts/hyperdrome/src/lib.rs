//! Hyperdrome game contract: Volts (NEP-141), drones, skins and mods (NEP-171/177/178/181), player
//! accounts, marketplace, packs and race settlement in one account. SPEC.md section 4.

pub mod constants;
pub mod constants_view;
pub mod events;
pub mod ft;
pub mod hashing;
pub mod market;
pub mod math;
pub mod nft;
pub mod owner;
pub mod packs;
pub mod player;
pub mod settlement;
pub mod types;
pub mod views;

#[cfg(test)]
mod unit_tests;

use std::borrow::Cow;

use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::fungible_token::metadata::{FT_METADATA_SPEC, FungibleTokenMetadata};
use near_contract_standards::non_fungible_token::metadata::{
    NFT_METADATA_SPEC, NFTContractMetadata,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, TokenId};
use near_sdk::collections::LazyOption;
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{AccountId, PanicOnDefault, env, near, require};

use crate::constants::{NFT_NAME, NFT_SYMBOL, VOLTS_DECIMALS, VOLTS_NAME, VOLTS_SYMBOL};
use crate::hashing::stats_hash_bytes;
use crate::math::is_locked_at;
use crate::types::{
    Batch, DroneCold, DroneHot, Item, Listing, PackCommit, Player, StorageKey, TeamBudget,
    VersionedBatch, VersionedDroneCold, VersionedDroneHot, VersionedItem, VersionedPlayer,
};

/// Contract state, version 1 (SPEC.md 4.2).
#[near(serializers = [borsh])]
pub struct StateV1 {
    pub owner_id: AccountId,
    pub treasury_id: AccountId,
    pub paused: bool,
    pub volts: FungibleToken,
    pub volts_meta: LazyOption<FungibleTokenMetadata>,
    pub nft: NonFungibleToken,
    pub nft_meta: LazyOption<NFTContractMetadata>,
    pub players: LookupMap<AccountId, VersionedPlayer>,
    pub drones_hot: LookupMap<TokenId, VersionedDroneHot>,
    pub drones_cold: LookupMap<TokenId, VersionedDroneCold>,
    pub items: LookupMap<TokenId, VersionedItem>,
    pub listings: LookupMap<TokenId, Listing>,
    /// Ids of active listings, for `get_listings` paging (SPEC.md 4.5).
    pub active_listings: IterableSet<TokenId>,
    pub batches: LookupMap<u64, VersionedBatch>,
    pub packs: LookupMap<u64, PackCommit>,
    pub teams: LookupMap<AccountId, TeamBudget>,
    pub skin_minted: LookupMap<u16, u32>,
    pub next_drone: u64,
    pub next_skin: u64,
    pub next_mod: u64,
    pub next_pack: u64,
}

#[near(serializers = [borsh])]
pub enum VersionedState {
    V1(StateV1),
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    state: VersionedState,
}

#[near]
impl Contract {
    /// Initializes the contract. Callable once, by anyone, right after deploy (the deploy
    /// transaction carries the init call). Registers the treasury for Volts. Fails if state
    /// already exists.
    #[init]
    pub fn new(owner_id: AccountId, treasury_id: AccountId) -> Self {
        let mut volts = FungibleToken::new(StorageKey::Volts);
        volts.internal_register_account(&treasury_id);
        let volts_meta = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: VOLTS_NAME.to_string(),
            symbol: VOLTS_SYMBOL.to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: VOLTS_DECIMALS,
        };
        let nft_meta = NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: NFT_NAME.to_string(),
            symbol: NFT_SYMBOL.to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        };
        let state = StateV1 {
            owner_id,
            treasury_id,
            paused: false,
            volts,
            volts_meta: LazyOption::new(StorageKey::VoltsMeta, Some(&volts_meta)),
            nft: NonFungibleToken::new(
                StorageKey::NftOwners,
                env::current_account_id(),
                None::<StorageKey>,
                Some(StorageKey::NftEnumeration),
                Some(StorageKey::NftApprovals),
            ),
            nft_meta: LazyOption::new(StorageKey::NftMeta, Some(&nft_meta)),
            players: LookupMap::new(StorageKey::Players),
            drones_hot: LookupMap::new(StorageKey::DronesHot),
            drones_cold: LookupMap::new(StorageKey::DronesCold),
            items: LookupMap::new(StorageKey::Items),
            listings: LookupMap::new(StorageKey::Listings),
            active_listings: IterableSet::new(StorageKey::ActiveListings),
            batches: LookupMap::new(StorageKey::Batches),
            packs: LookupMap::new(StorageKey::Packs),
            teams: LookupMap::new(StorageKey::Teams),
            skin_minted: LookupMap::new(StorageKey::SkinMinted),
            next_drone: 1,
            next_skin: 1,
            next_mod: 1,
            next_pack: 1,
        };
        Self {
            state: VersionedState::V1(state),
        }
    }

    /// Re-reads stored state after a code upgrade and converts it to the current version.
    /// Callable only by the contract account itself (deploy + call in one transaction). V1 is the
    /// current version, so this is a no-op read and write today. Fails if there is no state.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: Contract = env::state_read().unwrap_or_else(|| env::panic_str("no state"));
        match old.state {
            VersionedState::V1(state) => Self {
                state: VersionedState::V1(state),
            },
        }
    }
}

impl Contract {
    pub(crate) fn s(&self) -> &StateV1 {
        let VersionedState::V1(s) = &self.state;
        s
    }

    pub(crate) fn s_mut(&mut self) -> &mut StateV1 {
        let VersionedState::V1(s) = &mut self.state;
        s
    }

    pub(crate) fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.s().owner_id,
            "not owner"
        );
    }

    pub(crate) fn player(&self, account_id: &AccountId) -> Option<&Player> {
        self.s()
            .players
            .get(account_id)
            .map(|VersionedPlayer::V1(p)| p)
    }

    pub(crate) fn drone_hot(&self, token_id: &TokenId) -> Option<&DroneHot> {
        self.s()
            .drones_hot
            .get(token_id)
            .map(|VersionedDroneHot::V1(d)| d)
    }

    pub(crate) fn drone_cold(&self, token_id: &TokenId) -> Option<&DroneCold> {
        self.s()
            .drones_cold
            .get(token_id)
            .map(|VersionedDroneCold::V1(d)| d)
    }

    pub(crate) fn item(&self, token_id: &TokenId) -> Option<&Item> {
        self.s().items.get(token_id).map(|VersionedItem::V1(i)| i)
    }

    /// A batch in the current layout (a stored V1 record is converted, not rewritten: views
    /// cannot write).
    pub(crate) fn batch(&self, batch_id: u64) -> Option<Cow<'_, Batch>> {
        self.s().batches.get(&batch_id).map(VersionedBatch::current)
    }

    /// A batch for mutation; a stored V1 record is rewritten as V2.
    pub(crate) fn batch_mut(&mut self, batch_id: u64) -> Option<&mut Batch> {
        self.s_mut()
            .batches
            .get_mut(&batch_id)
            .map(VersionedBatch::upgrade)
    }

    pub(crate) fn token_owner(&self, token_id: &TokenId) -> Option<AccountId> {
        self.s().nft.owner_by_id.get(token_id)
    }

    /// Lock rule (SPEC.md 4.4): in a batch neither settled nor aborted, at least 120 s past its
    /// commit.
    pub(crate) fn is_locked(&self, hot: &DroneHot) -> bool {
        hot.in_batch.and_then(|id| self.batch(id)).is_some_and(|b| {
            !b.settled && !b.aborted && is_locked_at(b.committed_at_ms, env::block_timestamp_ms())
        })
    }

    /// Template id of the equipped mod or skin, or 0 when the slot is empty.
    pub(crate) fn equipped_template(&self, equipped: Option<&TokenId>) -> u16 {
        equipped
            .and_then(|t| self.item(t))
            .map_or(0, |i| i.template)
    }

    /// sha256(9 stat bytes ++ u16 mod template LE ++ u16 skin template LE), as settlement checks it.
    pub(crate) fn stats_hash_of(&self, token_id: &TokenId) -> Option<[u8; 32]> {
        let hot = self.drone_hot(token_id)?;
        let cold = self.drone_cold(token_id)?;
        Some(stats_hash_bytes(
            &cold.stats,
            self.equipped_template(hot.equipped_mod.as_ref()),
            self.equipped_template(hot.equipped_skin.as_ref()),
        ))
    }
}
