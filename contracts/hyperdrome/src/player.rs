//! Player methods on a drone (SPEC.md 4.4): `allocate_stats`, `equip`, `bind`, plus the guard and
//! the one spend path every player method uses. Marketplace methods are in market.rs; packs and
//! the vendor in packs.rs. Each is callable with the player's play key: no deposit, a `seq` equal
//! to the stored seq + 1.

use near_contract_standards::fungible_token::events::FtBurn;
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U128;
use near_sdk::{AccountId, env, near, require};

use crate::constants::catalog::SKIN_TIER_RENDERS;
use crate::constants::{DAY_MS, LEGENDARY, MARKET_RAKE_BP, ODDS_SCALE_BP};
use crate::events::Event;
use crate::math::{allocation_cost, stat_cap, stat_sum, tier, tsb};
use crate::types::{
    DroneHot, Item, ItemKind, VersionedDroneCold, VersionedDroneHot, VersionedItem, VersionedPlayer,
};
use crate::{Contract, ContractExt};

/// Skin equip rule (SPEC.md 2.6): legendary on any tier, others only where a tier render exists.
/// Placeholder skins have no tier render.
pub fn skin_equippable(item: &Item, level: u8) -> bool {
    if item.rarity == LEGENDARY {
        return true;
    }
    item.placeholder_name.is_none() && SKIN_TIER_RENDERS.contains(&(item.template, tier(level)))
}

/// Where the Volts of a spend go.
pub(crate) enum Payee<'a> {
    /// Burned (ft_burn with this memo): stat upgrades, packs, vendor drones.
    Burn(&'a str),
    /// A marketplace sale: 90% to the seller, 10% to the treasury (two ft_transfer events).
    Sale(&'a AccountId),
}

#[near]
impl Contract {
    /// Player only (play key). Raises `drone`'s stats to `stats`, paying 1 + floor(x / 10) Volts
    /// per point from x to x + 1 (SPEC.md 2.1); the Volts are burned. The caller must own the
    /// drone, it must not be listed or locked, no stat may decrease, each stat <= cap(level) and
    /// the sum <= TSB(level). Team accounts pass the team cap check. Emits ft_burn (when the cost is
    /// above 0) and `stats_allocated`. Fails with "paused", "not player", "bad seq", "not found",
    /// "listed", "not owner", "locked", "stat decrease", "over cap", "tsb exceeded",
    /// "insufficient volts" or "cap exceeded".
    pub fn allocate_stats(&mut self, drone: TokenId, stats: [u8; 9], seq: u64) {
        let caller = self.begin_player_action(seq);
        let hot = self.owned_drone(&drone, &caller);
        require!(!self.is_locked(&hot), "locked");
        let current = self
            .drone_cold(&drone)
            .unwrap_or_else(|| env::panic_str("not found"))
            .stats;
        let cost =
            allocation_cost(&current, &stats).unwrap_or_else(|| env::panic_str("stat decrease"));
        let cap = stat_cap(hot.level);
        require!(stats.iter().all(|&s| s <= cap), "over cap");
        require!(stat_sum(&stats) <= tsb(hot.level), "tsb exceeded");

        self.spend(&caller, u128::from(cost), Payee::Burn("allocate_stats"));
        if let Some(VersionedDroneCold::V1(c)) = self.s_mut().drones_cold.get_mut(&drone) {
            c.stats = stats;
            c.invested += cost;
        }
        Event::StatsAllocated { drone, stats, cost }.emit();
    }

    /// Player only (play key). Equips `item` in the `kind` slot of `drone`, or clears the slot when
    /// `item` is null. The caller must own the drone, which must not be listed or locked; the item
    /// must be of `kind` and bound to this drone; a skin must pass the tier rule (SPEC.md 2.6).
    /// Emits `equipped`. Fails with "paused", "not player", "bad seq", "not found" (no such item
    /// of that kind), "listed", "not owner" (item not bound to this drone), "locked" or "tier".
    pub fn equip(&mut self, drone: TokenId, item: Option<TokenId>, kind: ItemKind, seq: u64) {
        let caller = self.begin_player_action(seq);
        let hot = self.owned_drone(&drone, &caller);
        require!(!self.is_locked(&hot), "locked");
        if let Some(id) = &item {
            let record = self
                .item(id)
                .filter(|i| i.kind == kind)
                .unwrap_or_else(|| env::panic_str("not found"));
            require!(record.bound_to.as_ref() == Some(&drone), "not owner");
            require!(
                kind == ItemKind::Mod || skin_equippable(record, hot.level),
                "tier"
            );
        }
        if let Some(VersionedDroneHot::V1(h)) = self.s_mut().drones_hot.get_mut(&drone) {
            match kind {
                ItemKind::Skin => h.equipped_skin = item.clone(),
                ItemKind::Mod => h.equipped_mod = item.clone(),
            }
        }
        Event::Equipped { drone, kind, item }.emit();
    }

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

        self.internal_bind(&drone, &item, record.kind);
        if auto_equip {
            if let Some(VersionedDroneHot::V1(h)) = self.s_mut().drones_hot.get_mut(&drone) {
                match record.kind {
                    ItemKind::Skin => h.equipped_skin = Some(item.clone()),
                    ItemKind::Mod => h.equipped_mod = Some(item.clone()),
                }
            }
            Event::Equipped {
                drone,
                kind: record.kind,
                item: Some(item),
            }
            .emit();
        }
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

    /// The drone's hot state when it exists ("not found"), is not listed ("listed") and is owned
    /// by `caller` ("not owner").
    pub(crate) fn owned_drone(&self, drone: &TokenId, caller: &AccountId) -> DroneHot {
        let hot = self
            .drone_hot(drone)
            .unwrap_or_else(|| env::panic_str("not found"))
            .clone();
        require!(!self.s().listings.contains_key(drone), "listed");
        require!(
            self.token_owner(drone).as_ref() == Some(caller),
            "not owner"
        );
        hot
    }

    /// Binds `item` to `drone` on both sides and emits `item_bound`. Checks nothing.
    pub(crate) fn internal_bind(&mut self, drone: &TokenId, item: &TokenId, kind: ItemKind) {
        let s = self.s_mut();
        if let Some(VersionedItem::V1(i)) = s.items.get_mut(item) {
            i.bound_to = Some(drone.clone());
        }
        if let Some(VersionedDroneCold::V1(c)) = s.drones_cold.get_mut(drone) {
            match kind {
                ItemKind::Skin => c.bound_skins.push(item.clone()),
                ItemKind::Mod => c.bound_mods.push(item.clone()),
            }
        }
        Event::ItemBound {
            drone: drone.clone(),
            item: item.clone(),
        }
        .emit();
    }

    /// The one path for every Volt debit of a player method: balance check ("insufficient volts"),
    /// team cap check for team accounts ("cap exceeded"), then the debit. Returns the treasury fee
    /// (0 for a burn). An amount of 0 does nothing.
    pub(crate) fn spend(&mut self, payer: &AccountId, amount: u128, payee: Payee<'_>) -> u128 {
        if amount == 0 {
            return 0;
        }
        let balance = self.s().volts.accounts.get(payer).unwrap_or(0);
        require!(balance >= amount, "insufficient volts");
        self.charge_team_cap(payer, amount);
        match payee {
            Payee::Burn(memo) => {
                self.s_mut().volts.internal_withdraw(payer, amount);
                FtBurn {
                    owner_id: payer,
                    amount: U128(amount),
                    memo: Some(memo),
                }
                .emit();
                0
            }
            Payee::Sale(seller) => {
                let fee = amount * MARKET_RAKE_BP / u128::from(ODDS_SCALE_BP);
                let treasury = self.s().treasury_id.clone();
                self.pay(payer, seller, amount - fee);
                self.pay(payer, &treasury, fee);
                fee
            }
        }
    }

    /// Internal Volt transfer with an ft_transfer event; nothing moves when the amount is 0 or the
    /// payer pays itself.
    fn pay(&mut self, from: &AccountId, to: &AccountId, amount: u128) {
        if amount > 0 && from != to {
            self.s_mut()
                .volts
                .internal_transfer(from, to, amount, Some("market".to_string()));
        }
    }

    /// Team spend caps (SPEC.md 2.10): when `account` is a team, `amount` must be within its
    /// per-transaction cap and, with today's spend, its per-day cap; the day is
    /// `block_timestamp_ms / 86_400_000` and spend resets when it changes. A team without a budget
    /// row has zero caps. Regular players are never checked.
    fn charge_team_cap(&mut self, account: &AccountId, amount: u128) {
        if !self.player(account).is_some_and(|p| p.is_team) {
            return;
        }
        let today = u32::try_from(env::block_timestamp_ms() / DAY_MS).unwrap_or(u32::MAX);
        let Some(budget) = self.s_mut().teams.get_mut(account) else {
            env::panic_str("cap exceeded")
        };
        if budget.day != today {
            budget.day = today;
            budget.spent = 0;
        }
        let spent = budget.spent.saturating_add(amount);
        require!(
            amount <= budget.per_tx && spent <= budget.per_day,
            "cap exceeded"
        );
        budget.spent = spent;
    }
}
