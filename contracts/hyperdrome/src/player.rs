//! Player methods (SPEC.md 4.4). Each is callable with the player's play key: no deposit, a
//! `seq` equal to the stored seq + 1. `bind` is implemented; the rest land in T5 and panic with
//! "not implemented" until then so the play key's method list is valid from the first deploy.

use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U128;
use near_sdk::{AccountId, env, near, require};

use crate::constants::LEGENDARY;
use crate::constants::catalog::SKIN_TIER_RENDERS;
use crate::events::Event;
use crate::math::tier;
use crate::types::{
    Item, ItemKind, VersionedDroneCold, VersionedDroneHot, VersionedItem, VersionedPlayer,
};
use crate::{Contract, ContractExt};

const NOT_IMPLEMENTED: &str = "not implemented";

/// Skin equip rule (SPEC.md 2.6): legendary on any tier, others only where a tier render exists.
/// Placeholder skins have no tier render.
pub fn skin_equippable(item: &Item, level: u8) -> bool {
    if item.rarity == LEGENDARY {
        return true;
    }
    item.placeholder_name.is_none() && SKIN_TIER_RENDERS.contains(&(item.template, tier(level)))
}

#[near]
impl Contract {
    /// Player only (play key). Permanently binds `item` (a skin or mod) to `drone`; both must be
    /// owned by the caller, the item unbound and neither listed. Equips the item if that slot is
    /// empty, the drone is not locked and (for skins) the tier rule allows it. Emits `item_bound`,
    /// and `equipped` when it auto-equips. Fails with "paused", "not player", "bad seq",
    /// "not found", "not owner", "listed" or "bound item".
    pub fn bind(&mut self, drone: TokenId, item: TokenId, seq: u64) {
        let caller = self.begin_player_action(seq);
        let hot = self
            .drone_hot(&drone)
            .unwrap_or_else(|| env::panic_str("not found"))
            .clone();
        let record = self
            .item(&item)
            .unwrap_or_else(|| env::panic_str("not found"))
            .clone();
        require!(
            self.token_owner(&drone).as_ref() == Some(&caller),
            "not owner"
        );
        require!(
            self.token_owner(&item).as_ref() == Some(&caller),
            "not owner"
        );
        require!(
            !self.s().listings.contains_key(&drone) && !self.s().listings.contains_key(&item),
            "listed"
        );
        require!(record.bound_to.is_none(), "bound item");

        let slot_empty = match record.kind {
            ItemKind::Skin => hot.equipped_skin.is_none(),
            ItemKind::Mod => hot.equipped_mod.is_none(),
        };
        let fits = record.kind == ItemKind::Mod || skin_equippable(&record, hot.level);
        let auto_equip = slot_empty && fits && !self.is_locked(&hot);

        let s = self.s_mut();
        if let Some(VersionedItem::V1(i)) = s.items.get_mut(&item) {
            i.bound_to = Some(drone.clone());
        }
        if let Some(VersionedDroneCold::V1(c)) = s.drones_cold.get_mut(&drone) {
            match record.kind {
                ItemKind::Skin => c.bound_skins.push(item.clone()),
                ItemKind::Mod => c.bound_mods.push(item.clone()),
            }
        }
        if auto_equip && let Some(VersionedDroneHot::V1(h)) = s.drones_hot.get_mut(&drone) {
            match record.kind {
                ItemKind::Skin => h.equipped_skin = Some(item.clone()),
                ItemKind::Mod => h.equipped_mod = Some(item.clone()),
            }
        }
        Event::ItemBound {
            drone: drone.clone(),
            item: item.clone(),
        }
        .emit();
        if auto_equip {
            Event::Equipped {
                drone,
                kind: record.kind,
                item: Some(item),
            }
            .emit();
        }
    }

    /// T5. Player only. Raises drone stats, paying Volts per SPEC.md 2.1.
    pub fn allocate_stats(&mut self, drone: TokenId, stats: [u8; 9], seq: u64) {
        let _ = (drone, stats, seq);
        env::panic_str(NOT_IMPLEMENTED)
    }

    /// T5. Player only. Equips a bound item, or clears the slot.
    pub fn equip(&mut self, drone: TokenId, item: Option<TokenId>, kind: ItemKind, seq: u64) {
        let _ = (drone, item, kind, seq);
        env::panic_str(NOT_IMPLEMENTED)
    }

    /// T5. Player only. Lists a token in contract escrow.
    pub fn list(&mut self, token: TokenId, price: U128, seq: u64) {
        let _ = (token, price, seq);
        env::panic_str(NOT_IMPLEMENTED)
    }

    /// T5. Player only. Buys a listed token with Volts.
    pub fn buy(&mut self, token: TokenId, seq: u64) {
        let _ = (token, seq);
        env::panic_str(NOT_IMPLEMENTED)
    }

    /// T5. Player only. Cancels the caller's listing.
    pub fn cancel(&mut self, token: TokenId, seq: u64) {
        let _ = (token, seq);
        env::panic_str(NOT_IMPLEMENTED)
    }

    /// T5. Player only. Commits a pack or capsule open; returns the pack id.
    pub fn open_pack(&mut self, kind: ItemKind, tier: u8, hash: [u8; 32], seq: u64) -> u64 {
        let _ = (kind, tier, hash, seq);
        env::panic_str(NOT_IMPLEMENTED)
    }

    /// T5. Player only. Reveals a committed pack and mints its items.
    pub fn reveal_pack(&mut self, pack_id: u64, secret: [u8; 32], seq: u64) {
        let _ = (pack_id, secret, seq);
        env::panic_str(NOT_IMPLEMENTED)
    }

    /// T5. Player only. Buys a vendor drone for 3,500 Volts.
    pub fn vendor_buy_drone(&mut self, seq: u64) -> TokenId {
        let _ = seq;
        env::panic_str(NOT_IMPLEMENTED)
    }
}

impl Contract {
    /// Shared guard for player methods: not paused, caller registered, `seq == stored + 1`.
    /// Stores the new seq and returns the caller.
    pub(crate) fn begin_player_action(&mut self, seq: u64) -> AccountId {
        require!(!self.s().paused, "paused");
        let caller = env::predecessor_account_id();
        let Some(VersionedPlayer::V1(player)) = self.s_mut().players.get_mut(&caller) else {
            env::panic_str("not player")
        };
        require!(player.seq.checked_add(1) == Some(seq), "bad seq");
        player.seq = seq;
        caller
    }
}
