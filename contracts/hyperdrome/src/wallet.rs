//! Linked wallets and withdrawals (SPEC.md 4.4). A player links one wallet they control; from then
//! on only that wallet can change the link, and drones (with their bound items), unbound skins and
//! mods and Volts can leave the player account only for that wallet.

use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U128;
use near_sdk::{AccountId, assert_one_yocto, env, near, require};

use crate::constants::MAX_WITHDRAW_TOKENS;
use crate::events::Event;
use crate::types::DroneHot;
use crate::{Contract, ContractExt};

#[near]
impl Contract {
    /// Owner only (ops key). Links `wallet` to `player` and registers it for Volts if needed (the
    /// contract pays, SPEC.md 13). Emits `wallet_linked`. Fails with "not owner", "not found"
    /// (unknown player), "team" (team accounts cannot link), "bad wallet" (the game account, the
    /// owner or any account under the game account) or "linked" (a link exists).
    pub fn link_wallet(&mut self, player: AccountId, wallet: AccountId) {
        self.assert_owner();
        let record = self
            .player(&player)
            .unwrap_or_else(|| env::panic_str("not found"));
        require!(!record.is_team, "team");
        require!(self.wallet_allowed(&wallet), "bad wallet");
        require!(!self.s().wallet_links.contains_key(&player), "linked");
        let s = self.s_mut();
        if !s.volts.accounts.contains_key(&wallet) {
            s.volts.internal_register_account(&wallet);
        }
        s.wallet_links.insert(player.clone(), wallet.clone());
        Event::WalletLinked { player, wallet }.emit();
    }

    /// The linked wallet only, with exactly 1 yocto. Removes `player`'s link. Emits
    /// `wallet_unlinked`. Fails with "not linked" or "not owner" (any other caller).
    #[payable]
    pub fn unlink_wallet(&mut self, player: AccountId) {
        assert_one_yocto();
        let wallet = self.linked_wallet(&player);
        require!(env::predecessor_account_id() == wallet, "not owner");
        self.s_mut().wallet_links.remove(&player);
        Event::WalletUnlinked { player, wallet }.emit();
    }

    /// The owner (ops key, no deposit) or the linked wallet (exactly 1 yocto). Moves `tokens` and
    /// `volts` from `player` to the linked wallet; a drone carries every bound item. Emits one
    /// nep171 nft_transfer per requested token (`authorized_id` = the caller), one nep141
    /// ft_transfer when `volts` is above 0, and one `withdrawn`. Any failure reverts the whole
    /// call. Fails with "not linked", "not owner" (any other caller, or a token `player` does not
    /// own), "bad deposit" (the owner attached a deposit), "nothing to withdraw", "too many tokens"
    /// (more than 4.4's limit, bound items included), "not found", "listed", "bound item" (a bound
    /// skin or mod requested alone), "locked" (a drone in an unsettled batch), "insufficient volts"
    /// or "not registered" (the wallet removed its Volts registration).
    #[payable]
    pub fn withdraw(&mut self, player: AccountId, tokens: Vec<TokenId>, volts: U128) {
        let wallet = self.linked_wallet(&player);
        let caller = env::predecessor_account_id();
        if caller == self.s().owner_id {
            require!(env::attached_deposit().is_zero(), "bad deposit");
        } else {
            assert_one_yocto();
            require!(caller == wallet, "not owner");
        }
        require!(!tokens.is_empty() || volts.0 > 0, "nothing to withdraw");

        let moved: usize = tokens.iter().map(|t| self.moved_count(t)).sum();
        require!(moved <= MAX_WITHDRAW_TOKENS as usize, "too many tokens");

        for token in &tokens {
            require!(!self.s().listings.contains_key(token), "listed");
            let owner = self
                .token_owner(token)
                .unwrap_or_else(|| env::panic_str("not found"));
            require!(owner == player, "not owner");
            if let Some(item) = self.item(token) {
                require!(item.bound_to.is_none(), "bound item");
            }
            if let Some(hot) = self.drone_hot(token) {
                require!(!self.in_open_batch(hot), "locked");
            }
            self.move_with_bound(&player, &wallet, token, Some(&caller), None);
        }

        if volts.0 > 0 {
            let s = self.s_mut();
            require!(s.volts.accounts.contains_key(&wallet), "not registered");
            require!(
                s.volts.internal_unwrap_balance_of(&player) >= volts.0,
                "insufficient volts"
            );
            s.volts.internal_transfer(&player, &wallet, volts.0, None);
        }
        Event::Withdrawn {
            player,
            wallet,
            tokens,
            volts,
        }
        .emit();
    }
}

impl Contract {
    fn linked_wallet(&self, player: &AccountId) -> AccountId {
        self.s()
            .wallet_links
            .get(player)
            .cloned()
            .unwrap_or_else(|| env::panic_str("not linked"))
    }

    /// A wallet must not be the game account, the owner or an account under the game account.
    fn wallet_allowed(&self, wallet: &AccountId) -> bool {
        let game = env::current_account_id();
        let under_game = format!(".{game}");
        wallet != &game && wallet != &self.s().owner_id && !wallet.as_str().ends_with(&under_game)
    }

    /// In a batch that is neither settled nor aborted, from its commit on (stricter than the lock
    /// rule, which starts 120 s after the commit).
    fn in_open_batch(&self, hot: &DroneHot) -> bool {
        hot.in_batch
            .and_then(|id| self.batch(id))
            .is_some_and(|b| !b.settled && !b.aborted)
    }
}
