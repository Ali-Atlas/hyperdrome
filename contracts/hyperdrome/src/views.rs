//! Custom views (SPEC.md 4.5). Standard `ft_*` and `nft_*` views live in ft.rs and nft.rs.

use std::borrow::Cow;

use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U128;
use near_sdk::{AccountId, near};

use crate::constants::catalog::{MODS, RARITY_NAMES, SKINS, STAT_NAMES, skin_supply_cap};
use crate::constants_view::{Constants, ModTemplateView};
use crate::types::{Batch, DroneCold, DroneHot, ItemKind, Player};
use crate::{Contract, ContractExt};

#[near(serializers = [json])]
pub struct DroneView {
    pub token_id: TokenId,
    pub owner: AccountId,
    pub hot: DroneHot,
    pub cold: DroneCold,
    pub listed: bool,
    pub locked: bool,
}

#[near(serializers = [json])]
pub struct ItemView {
    pub token_id: TokenId,
    pub owner: AccountId,
    pub kind: ItemKind,
    pub template: u16,
    pub rarity: u8,
    pub bound_to: Option<TokenId>,
    pub placeholder_name: Option<String>,
}

#[near(serializers = [json])]
pub struct ListingView {
    pub token_id: TokenId,
    pub seller: AccountId,
    pub price: U128,
    pub listed_at_ms: u64,
}

#[near(serializers = [json])]
pub struct TeamBudgetView {
    pub per_tx: U128,
    pub per_day: U128,
    pub spent: U128,
    pub day: u32,
}

#[near(serializers = [json])]
pub struct CatalogSkin {
    pub id: u16,
    pub slug: String,
    pub file: String,
    pub rarity: u8,
    pub rarity_name: String,
    /// Supply cap; null for Ember, the uncapped starter skin.
    pub cap: Option<u32>,
    pub minted: u32,
}

#[near(serializers = [json])]
pub struct Catalog {
    pub skins: Vec<CatalogSkin>,
    pub mods: Vec<ModTemplateView>,
    pub stat_names: Vec<String>,
}

#[near]
impl Contract {
    /// View. Every game constant that affects settlement (SPEC.md 2 and 4.6).
    pub fn get_constants(&self) -> Constants {
        Constants::build()
    }

    /// View. The player's seq, creation time and team flag, or null if unregistered.
    pub fn get_player(&self, account: AccountId) -> Option<Player> {
        self.player(&account).cloned()
    }

    /// View. A drone's hot and cold state, owner, listed and locked flags, or null.
    pub fn get_drone(&self, token: TokenId) -> Option<DroneView> {
        let hot = self.drone_hot(&token)?.clone();
        let cold = self.drone_cold(&token)?.clone();
        let owner = self.token_owner(&token)?;
        let listed = self.s().listings.contains_key(&token);
        let locked = self.is_locked(&hot);
        Some(DroneView {
            token_id: token,
            owner,
            hot,
            cold,
            listed,
            locked,
        })
    }

    /// View. `get_drone` for each token, in order.
    pub fn get_drones(&self, tokens: Vec<TokenId>) -> Vec<Option<DroneView>> {
        tokens.into_iter().map(|t| self.get_drone(t)).collect()
    }

    /// View. A skin or mod, or null.
    pub fn get_item(&self, token: TokenId) -> Option<ItemView> {
        let item = self.item(&token)?.clone();
        let owner = self.token_owner(&token)?;
        Some(ItemView {
            token_id: token,
            owner,
            kind: item.kind,
            template: item.template,
            rarity: item.rarity,
            bound_to: item.bound_to,
            placeholder_name: item.placeholder_name,
        })
    }

    /// View. `get_item` for each token, in order.
    pub fn get_items(&self, tokens: Vec<TokenId>) -> Vec<Option<ItemView>> {
        tokens.into_iter().map(|t| self.get_item(t)).collect()
    }

    /// View. An active listing, or null.
    pub fn get_listing(&self, token: TokenId) -> Option<ListingView> {
        let l = self.s().listings.get(&token)?;
        Some(ListingView {
            token_id: token,
            seller: l.seller.clone(),
            price: U128(l.price),
            listed_at_ms: l.listed_at_ms,
        })
    }

    /// View. Active listings, `limit` of them starting at index `from`.
    pub fn get_listings(&self, from: u64, limit: u64) -> Vec<ListingView> {
        let from = usize::try_from(from).unwrap_or(usize::MAX);
        let limit = usize::try_from(limit).unwrap_or(usize::MAX);
        self.s()
            .active_listings
            .iter()
            .skip(from)
            .take(limit)
            .filter_map(|t| self.get_listing(t.clone()))
            .collect()
    }

    /// View. A committed batch (seed hash, commit time, matchups, settled, settled_count,
    /// aborted), or null. `matchups` is empty once the batch is settled or aborted.
    pub fn get_batch(&self, id: u64) -> Option<Batch> {
        self.batch(id).map(Cow::into_owned)
    }

    /// View. An AI team's spend caps and today's spend, or null.
    pub fn get_team(&self, account: AccountId) -> Option<TeamBudgetView> {
        let b = self.s().teams.get(&account)?;
        Some(TeamBudgetView {
            per_tx: U128(b.per_tx),
            per_day: U128(b.per_day),
            spent: U128(b.spent),
            day: b.day,
        })
    }

    /// View. Skin templates with supply caps (null for Ember) and minted counts, and mod templates.
    pub fn get_catalog(&self) -> Catalog {
        let skins = SKINS
            .iter()
            .map(|t| CatalogSkin {
                id: t.id,
                slug: t.slug.to_string(),
                file: t.file.to_string(),
                rarity: t.rarity,
                rarity_name: RARITY_NAMES[usize::from(t.rarity)].to_string(),
                cap: skin_supply_cap(t.id, t.rarity),
                minted: self.s().skin_minted.get(&t.id).copied().unwrap_or(0),
            })
            .collect();
        Catalog {
            skins,
            mods: MODS.iter().map(ModTemplateView::from).collect(),
            stat_names: STAT_NAMES.iter().map(|s| s.to_string()).collect(),
        }
    }

    /// View. The wallet linked to `player`, or null (SPEC.md 4.4 `link_wallet`).
    pub fn get_wallet_link(&self, player: AccountId) -> Option<AccountId> {
        self.s().wallet_links.get(&player).cloned()
    }

    /// View. The hash `settle_batch` checks for this drone: sha256(9 stat bytes ++ u16 equipped
    /// mod template LE ++ u16 equipped skin template LE), 0 for an empty slot. Null if not a drone.
    pub fn stats_hash(&self, token: TokenId) -> Option<[u8; 32]> {
        self.stats_hash_of(&token)
    }
}
