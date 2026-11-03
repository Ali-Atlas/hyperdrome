//! Marketplace (SPEC.md 2.8 and 4.4): listings are escrowed by the contract account. A listed
//! drone keeps racing and keeps `in_batch`; it moves with every bound item.

use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U128;
use near_sdk::{env, near, require};

use crate::constants::MARKET_MIN_PRICE;
use crate::events::Event;
use crate::player::Payee;
use crate::types::Listing;
use crate::{Contract, ContractExt};

#[near]
impl Contract {
    /// Player only (play key). Lists `token` (a drone, or an unbound skin or mod) for `price`
    /// Volts: the token (with a drone's bound items) moves to the contract account in escrow.
    /// Emits nep171 nft_transfer and `listed`. Fails with "paused", "not player", "bad seq",
    /// "low price" (under 10), "not found", "listed", "not owner" or "bound item".
    pub fn list(&mut self, token: TokenId, price: U128, seq: u64) {
        let caller = self.begin_player_action(seq);
        require!(price.0 >= MARKET_MIN_PRICE, "low price");
        let owner = self
            .token_owner(&token)
            .unwrap_or_else(|| env::panic_str("not found"));
        require!(!self.s().listings.contains_key(&token), "listed");
        require!(owner == caller, "not owner");
        if let Some(item) = self.item(&token) {
            require!(item.bound_to.is_none(), "bound item");
        }

        let escrow = env::current_account_id();
        self.move_with_bound(&caller, &escrow, &token, None, Some("list"));
        let listing = Listing {
            seller: caller.clone(),
            price: price.0,
            listed_at_ms: env::block_timestamp_ms(),
        };
        let s = self.s_mut();
        s.listings.insert(token.clone(), listing);
        s.active_listings.insert(token.clone());
        Event::Listed {
            token,
            seller: caller,
            price,
        }
        .emit();
    }

    /// Player only (play key). Buys listed `token` for its price: the buyer pays 90% to the seller
    /// and 10% to the treasury (team accounts pass the team cap check), the listing is removed and
    /// the token (with a drone's bound items) moves from escrow to the buyer. Emits two nep141
    /// ft_transfer, one nep171 nft_transfer and `sold`. Fails with "paused", "not player",
    /// "bad seq", "not listed", "self buy", "insufficient volts" or "cap exceeded".
    pub fn buy(&mut self, token: TokenId, seq: u64) {
        let caller = self.begin_player_action(seq);
        let listing = self
            .s()
            .listings
            .get(&token)
            .cloned()
            .unwrap_or_else(|| env::panic_str("not listed"));
        require!(listing.seller != caller, "self buy");

        let fee = self.spend(&caller, listing.price, Payee::Sale(&listing.seller));
        self.remove_listing(&token);
        let escrow = env::current_account_id();
        self.move_with_bound(&escrow, &caller, &token, None, Some("buy"));
        Event::Sold {
            token,
            seller: listing.seller,
            buyer: caller,
            price: U128(listing.price),
            fee: U128(fee),
        }
        .emit();
    }

    /// Player only (play key). Cancels the caller's listing of `token`; the token (with a drone's
    /// bound items) returns from escrow to the seller. Emits nep171 nft_transfer and `cancelled`.
    /// Fails with "paused", "not player", "bad seq", "not listed" or "not owner" (not the seller).
    pub fn cancel(&mut self, token: TokenId, seq: u64) {
        let caller = self.begin_player_action(seq);
        let seller = self
            .s()
            .listings
            .get(&token)
            .map(|l| l.seller.clone())
            .unwrap_or_else(|| env::panic_str("not listed"));
        require!(seller == caller, "not owner");

        self.remove_listing(&token);
        let escrow = env::current_account_id();
        self.move_with_bound(&escrow, &caller, &token, None, Some("cancel"));
        Event::Cancelled { token }.emit();
    }
}

impl Contract {
    fn remove_listing(&mut self, token: &TokenId) {
        let s = self.s_mut();
        s.listings.remove(token);
        s.active_listings.remove(token);
    }
}
