//! Volts: NEP-141 core, resolver and metadata, plus NEP-145 storage management (SPEC.md 4.3).
//! All standard; transfers need 1 yocto, so play keys cannot reach them.

use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::fungible_token::events::FtBurn;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{AccountId, NearToken, PromiseOrValue, env, near};

use crate::{Contract, ContractExt};

#[near]
impl FungibleTokenCore for Contract {
    /// Any registered holder, 1 yocto. Standard NEP-141 transfer; emits ft_transfer.
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.s_mut().volts.ft_transfer(receiver_id, amount, memo)
    }

    /// Any registered holder, 1 yocto. Standard NEP-141 transfer-and-call.
    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.s_mut()
            .volts
            .ft_transfer_call(receiver_id, amount, memo, msg)
    }

    /// View. Total Volts in circulation.
    fn ft_total_supply(&self) -> U128 {
        self.s().volts.ft_total_supply()
    }

    /// View. Volts held by `account_id` (0 if unregistered).
    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.s().volts.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    /// Callback of `ft_transfer_call`, callable only by this contract. Refunds unused Volts to
    /// the sender; Volts that cannot be refunded to an unregistered sender are burned (ft_burn).
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used, burned) =
            self.s_mut()
                .volts
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned > 0 {
            FtBurn {
                owner_id: &sender_id,
                amount: U128(burned),
                memo: Some("refund to unregistered sender"),
            }
            .emit();
        }
        U128(used)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    /// View. Volts metadata: name "Volts", symbol "VOLT", 0 decimals.
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.s()
            .volts_meta
            .get()
            .unwrap_or_else(|| env::panic_str("no metadata"))
    }
}

#[near]
impl StorageManagement for Contract {
    /// Anyone, with a deposit. Standard NEP-145 registration for Volts (players are registered by
    /// the contract in `register_player`, so they never need this).
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.s_mut()
            .volts
            .storage_deposit(account_id, registration_only)
    }

    /// Registered account, 1 yocto. Standard NEP-145.
    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.s_mut().volts.storage_withdraw(amount)
    }

    /// Registered account, 1 yocto. Standard NEP-145; `force` burns a non-zero balance.
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        let burned = self.s_mut().volts.internal_storage_unregister(force);
        if let Some((account_id, balance)) = &burned
            && *balance > 0
        {
            FtBurn {
                owner_id: account_id,
                amount: U128(*balance),
                memo: Some("storage unregister"),
            }
            .emit();
        }
        burned.is_some()
    }

    /// View. Standard NEP-145.
    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.s().volts.storage_balance_bounds()
    }

    /// View. Standard NEP-145.
    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.s().volts.storage_balance_of(account_id)
    }
}
