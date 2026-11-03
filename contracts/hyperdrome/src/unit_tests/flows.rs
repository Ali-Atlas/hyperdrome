//! In-process method tests for paths the sandbox cannot reach cheaply or deterministically:
//! placeholder minting once a rarity's catalog supply is exhausted, and the team cap's day
//! rollover. State is built only through public methods.

use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, testing_env};

use crate::Contract;
use crate::constants::COMMON;
use crate::constants::catalog::SKINS;
use crate::constants::names::PLACEHOLDER_COMMON;
use crate::types::ItemKind;

const DAY_MS: u64 = 86_400_000;

fn account(name: &str) -> AccountId {
    name.parse()
        .unwrap_or_else(|e| panic!("bad test account {name}: {e}"))
}

/// Sets the caller, time and block height; the random seed varies with the height.
fn as_caller(caller: &str, now_ms: u64, height: u64) {
    let seed = [u8::try_from(height % 256).unwrap_or(0); 32];
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(account("game.testnet"))
            .predecessor_account_id(account(caller))
            .block_timestamp(now_ms * 1_000_000)
            .block_height(height)
            .random_seed(seed)
            .build()
    );
}

/// A contract with `player` registered (as a team when `is_team`) and holding `volts`.
fn setup(player: &str, is_team: bool, volts: u128) -> Contract {
    as_caller("owner.testnet", 0, 1);
    let mut c = Contract::new(account("owner.testnet"), account("owner.testnet"));
    c.internal_register_player(&account(player), is_team);
    c.mint_volts(account(player), U128(volts));
    c
}

/// Mints every common catalog skin up to its supply cap. A fresh context per template keeps each
/// under the 100-log limit; storage carries over.
fn exhaust_commons(c: &mut Contract) {
    for t in SKINS.iter().filter(|t| t.rarity == COMMON) {
        as_caller("owner.testnet", 0, 1);
        for _ in 0..10 {
            c.mint_item(account("owner.testnet"), ItemKind::Skin, t.id, None);
        }
    }
}

fn skin_of(c: &Contract, drone: &TokenId) -> TokenId {
    c.get_drone(drone.clone())
        .and_then(|d| d.cold.bound_skins.first().cloned())
        .unwrap_or_default()
}

#[test]
fn vendor_binds_a_placeholder_skin_when_commons_are_exhausted() {
    let mut c = setup("p-a.game.testnet", false, 10_000);
    exhaust_commons(&mut c);
    as_caller("p-a.game.testnet", 0, 2);
    let drone = c.vendor_buy_drone(1);
    let skin = c
        .get_item(skin_of(&c, &drone))
        .unwrap_or_else(|| panic!("no skin"));
    assert_eq!((skin.template, skin.rarity), (0, COMMON));
    let name = skin.placeholder_name.unwrap_or_default();
    assert!(PLACEHOLDER_COMMON.contains(&name.as_str()), "{name}");
    let catalog = c.get_catalog();
    assert!(
        catalog
            .skins
            .iter()
            .filter(|s| s.rarity == COMMON)
            .all(|s| s.minted == 10),
        "placeholders never count against supply"
    );
}

#[test]
fn starter_pack_mints_a_placeholder_when_its_rarity_is_exhausted() {
    let mut c = setup("p-a.game.testnet", false, 10_000);
    exhaust_commons(&mut c);
    let secret = [5u8; 32];
    as_caller("p-a.game.testnet", 0, 2);
    let pack = c.open_pack(ItemKind::Skin, 0, near_sdk::env::sha256_array(secret), 1);
    as_caller("p-a.game.testnet", 0, 3);
    c.reveal_pack(pack, secret, 2);
    // Slot 1 of a starter pack is always common, and no common has supply left.
    let first = c
        .get_item("s:81".to_string())
        .unwrap_or_else(|| panic!("no item"));
    assert_eq!((first.template, first.rarity), (0, COMMON));
    assert!(first.placeholder_name.is_some());
}

#[test]
fn team_spend_resets_on_a_new_day() {
    let team = "vortex.game.testnet";
    let mut c = setup(team, true, 20_000);
    c.set_team_budget(account(team), U128(5_000), U128(5_000));
    as_caller(team, 10 * DAY_MS + 1, 2);
    c.vendor_buy_drone(1);
    as_caller(team, 11 * DAY_MS, 3);
    c.vendor_buy_drone(2);
    let budget = c
        .get_team(account(team))
        .unwrap_or_else(|| panic!("no budget"));
    assert_eq!((budget.spent, budget.day), (U128(3_500), 11));
}

#[test]
#[should_panic(expected = "cap exceeded")]
fn team_spend_over_the_day_cap_fails_the_same_day() {
    let team = "vortex.game.testnet";
    let mut c = setup(team, true, 20_000);
    c.set_team_budget(account(team), U128(5_000), U128(5_000));
    as_caller(team, 10 * DAY_MS + 1, 2);
    c.vendor_buy_drone(1);
    as_caller(team, 11 * DAY_MS - 1, 3);
    c.vendor_buy_drone(2);
}
