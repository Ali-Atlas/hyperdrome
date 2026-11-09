//! NEP-171/177/178/181 (SPEC.md 4.3). Transfers are written by hand so the bound-item rules hold:
//! a bound skin or mod never moves alone, and a drone always moves with every item bound to it.
//! Token metadata is built on read from contract state, so `extra` stays current.

use std::collections::HashMap;

use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver, ext_nft_receiver,
};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::NftTransfer;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata,
};
use near_contract_standards::non_fungible_token::{Token, TokenId};
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::{AccountId, Gas, PromiseOrValue, assert_one_yocto, env, near, require};

use crate::constants::catalog::{RARITY_NAMES, mod_template, skin_template};
use crate::math::tier;
use crate::types::ItemKind;
use crate::{Contract, ContractExt};

const GAS_FOR_RESOLVE_TRANSFER: Gas = Gas::from_tgas(20);
const RESOLVE_RESULT_MAX_LEN: usize = "false".len();

impl Contract {
    /// How many token ids a transfer of `token_id` moves: 1, plus every item bound to a drone.
    pub(crate) fn moved_count(&self, token_id: &TokenId) -> usize {
        self.drone_cold(token_id)
            .map_or(1, |cold| 1 + cold.bound_skins.len() + cold.bound_mods.len())
    }

    /// The token plus, for a drone, every skin and mod bound to it.
    fn tokens_moving_with(&self, token_id: &TokenId) -> Vec<TokenId> {
        let mut tokens = vec![token_id.clone()];
        if let Some(cold) = self.drone_cold(token_id) {
            tokens.extend(cold.bound_skins.iter().cloned());
            tokens.extend(cold.bound_mods.iter().cloned());
        }
        tokens
    }

    /// Checks the bound-item, listing and lock rules and the sender's authority, then moves the
    /// token (and a drone's bound items), clears their approvals and emits one nft_transfer
    /// listing every moved token. Returns the old owner and the token's cleared approvals.
    fn guarded_transfer(
        &mut self,
        sender_id: &AccountId,
        receiver_id: &AccountId,
        token_id: &TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) -> (AccountId, Option<HashMap<AccountId, u64>>) {
        require!(!self.s().listings.contains_key(token_id), "listed");
        if let Some(item) = self.item(token_id) {
            require!(item.bound_to.is_none(), "bound item");
        }
        if let Some(hot) = self.drone_hot(token_id) {
            require!(!self.is_locked(hot), "locked");
        }
        let owner_id = self
            .token_owner(token_id)
            .unwrap_or_else(|| env::panic_str("not found"));

        let approvals = self
            .s_mut()
            .nft
            .approvals_by_id
            .as_mut()
            .map(|a| a.remove(token_id).unwrap_or_default());
        if sender_id != &owner_id {
            let approved = approvals.as_ref().and_then(|a| a.get(sender_id));
            require!(approved.is_some(), "not owner");
            require!(
                approval_id.is_none() || approved == approval_id.as_ref(),
                "not owner"
            );
        }
        require!(&owner_id != receiver_id, "same owner");
        let authorized = (sender_id != &owner_id).then_some(sender_id);
        self.move_with_bound(
            &owner_id,
            receiver_id,
            token_id,
            authorized,
            memo.as_deref(),
        );
        (owner_id, approvals)
    }

    /// Moves `token_id` (and, for a drone, every bound item) from `owner_id` to `receiver_id`,
    /// clears their approvals and emits one nft_transfer listing every moved token. Checks no
    /// rules: callers (`guarded_transfer`, the marketplace escrow) enforce them first.
    pub(crate) fn move_with_bound(
        &mut self,
        owner_id: &AccountId,
        receiver_id: &AccountId,
        token_id: &TokenId,
        authorized_id: Option<&AccountId>,
        memo: Option<&str>,
    ) {
        let moving = self.tokens_moving_with(token_id);
        let nft = &mut self.s_mut().nft;
        for t in &moving {
            if let Some(by_id) = nft.approvals_by_id.as_mut() {
                by_id.remove(t);
            }
            nft.internal_transfer_unguarded(t, owner_id, receiver_id);
        }
        let ids: Vec<&str> = moving.iter().map(String::as_str).collect();
        NftTransfer {
            old_owner_id: owner_id,
            new_owner_id: receiver_id,
            token_ids: &ids,
            authorized_id: authorized_id.map(|a| a.as_ref()),
            memo,
        }
        .emit();
    }

    /// Token metadata built from state. Media needs `base_uri` (set with `set_base_uri`).
    pub(crate) fn token_metadata(&self, token_id: &TokenId) -> TokenMetadata {
        let base_uri = self.s().nft_meta.get().and_then(|m| m.base_uri);
        let (title, extra) = if let (Some(hot), Some(cold)) =
            (self.drone_hot(token_id), self.drone_cold(token_id))
        {
            let extra = json!({
                "kind": "drone",
                "level": hot.level,
                "elo": hot.elo,
                "tier": tier(hot.level),
                "equipped": { "mod": hot.equipped_mod, "skin": hot.equipped_skin },
            });
            (Some(cold.name.clone()), extra)
        } else if let Some(item) = self.item(token_id) {
            let name = match (item.kind, &item.placeholder_name) {
                (_, Some(placeholder)) => Some(placeholder.clone()),
                (ItemKind::Skin, None) => skin_template(item.template).map(|t| t.slug.to_string()),
                (ItemKind::Mod, None) => mod_template(item.template).map(|t| t.name.to_string()),
            };
            let extra = json!({
                "kind": item.kind,
                "template": item.template,
                "rarity": RARITY_NAMES.get(usize::from(item.rarity)),
                "bound_to": item.bound_to,
            });
            (name, extra)
        } else {
            (None, json!({}))
        };
        TokenMetadata {
            title,
            description: None,
            media: base_uri.map(|b| format!("{b}/{token_id}/image")),
            media_hash: None,
            copies: None,
            issued_at: None,
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: Some(extra.to_string()),
            reference: None,
            reference_hash: None,
        }
    }

    fn with_metadata(&self, mut token: Token) -> Token {
        token.metadata = Some(self.token_metadata(&token.token_id));
        token
    }
}

#[near]
impl NonFungibleTokenCore for Contract {
    /// Owner or approved account, with exactly 1 yocto (so play keys cannot call it). Moves the
    /// token; a drone carries every bound item. Emits one nep171 nft_transfer. Fails with
    /// "listed", "bound item", "locked", "not found", "not owner" or "same owner".
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        let sender_id = env::predecessor_account_id();
        self.guarded_transfer(&sender_id, &receiver_id, &token_id, approval_id, memo);
    }

    /// As `nft_transfer`, then calls `nft_on_transfer` on the receiver; `nft_resolve_transfer`
    /// returns the token (and a drone's bound items) if the receiver asks for it back.
    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        assert_one_yocto();
        let sender_id = env::predecessor_account_id();
        let (old_owner, old_approvals) =
            self.guarded_transfer(&sender_id, &receiver_id, &token_id, approval_id, memo);
        ext_nft_receiver::ext(receiver_id.clone())
            .with_unused_gas_weight(1)
            .nft_on_transfer(sender_id, old_owner.clone(), token_id.clone(), msg)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_RESOLVE_TRANSFER)
                    .with_unused_gas_weight(0)
                    .nft_resolve_transfer(old_owner, receiver_id, token_id, old_approvals),
            )
            .into()
    }

    /// View. The token with metadata built from current state (`extra` = JSON summary).
    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.s()
            .nft
            .nft_token(token_id)
            .map(|t| self.with_metadata(t))
    }
}

#[near]
impl NonFungibleTokenResolver for Contract {
    /// Callback of `nft_transfer_call`, callable only by this contract. If the receiver returned
    /// true and still owns the token, moves it and its bound items back to the previous owner and
    /// restores the token's approvals. Returns whether the transfer stands.
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        let must_revert = env::promise_result_checked(0, RESOLVE_RESULT_MAX_LEN)
            .ok()
            .and_then(|v| serde_json::from_slice::<bool>(&v).ok())
            .unwrap_or(true);
        if !must_revert || self.token_owner(&token_id).as_ref() != Some(&receiver_id) {
            return true;
        }
        let moving = self.tokens_moving_with(&token_id);
        let nft = &mut self.s_mut().nft;
        for t in &moving {
            if let Some(by_id) = nft.approvals_by_id.as_mut() {
                by_id.remove(t);
            }
            nft.internal_transfer_unguarded(t, &receiver_id, &previous_owner_id);
        }
        if let (Some(by_id), Some(approvals)) = (nft.approvals_by_id.as_mut(), approved_account_ids)
        {
            by_id.insert(&token_id, &approvals);
        }
        let ids: Vec<&str> = moving.iter().map(String::as_str).collect();
        NftTransfer {
            old_owner_id: &receiver_id,
            new_owner_id: &previous_owner_id,
            token_ids: &ids,
            authorized_id: None,
            memo: None,
        }
        .emit();
        false
    }
}

#[near]
impl NonFungibleTokenApproval for Contract {
    /// Token owner, with a deposit covering approval storage. Standard NEP-178.
    #[payable]
    fn nft_approve(
        &mut self,
        token_id: TokenId,
        account_id: AccountId,
        msg: Option<String>,
    ) -> Option<near_sdk::Promise> {
        self.s_mut().nft.nft_approve(token_id, account_id, msg)
    }

    /// Token owner, 1 yocto. Standard NEP-178.
    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        self.s_mut().nft.nft_revoke(token_id, account_id)
    }

    /// Token owner, 1 yocto. Standard NEP-178.
    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) {
        self.s_mut().nft.nft_revoke_all(token_id)
    }

    /// View. Standard NEP-178.
    fn nft_is_approved(
        &self,
        token_id: TokenId,
        approved_account_id: AccountId,
        approval_id: Option<u64>,
    ) -> bool {
        self.s()
            .nft
            .nft_is_approved(token_id, approved_account_id, approval_id)
    }
}

#[near]
impl NonFungibleTokenEnumeration for Contract {
    /// View. Number of drones, skins and mods.
    fn nft_total_supply(&self) -> U128 {
        self.s().nft.nft_total_supply()
    }

    /// View. Tokens by index, with current metadata.
    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.s()
            .nft
            .nft_tokens(from_index, limit)
            .into_iter()
            .map(|t| self.with_metadata(t))
            .collect()
    }

    /// View. Number of tokens owned by `account_id`.
    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.s().nft.nft_supply_for_owner(account_id)
    }

    /// View. Tokens owned by `account_id`, with current metadata.
    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.s()
            .nft
            .nft_tokens_for_owner(account_id, from_index, limit)
            .into_iter()
            .map(|t| self.with_metadata(t))
            .collect()
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    /// View. Collection metadata (NEP-177).
    fn nft_metadata(&self) -> NFTContractMetadata {
        self.s()
            .nft_meta
            .get()
            .unwrap_or_else(|| env::panic_str("no metadata"))
    }
}
