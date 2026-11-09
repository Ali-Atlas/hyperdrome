//! Ember (template 4) is the uncapped starter skin (SPEC.md 2.6): minting never hits its supply
//! cap, pack rolls and the vendor drone's common skin pick never draw it, and `get_catalog`
//! reports no cap for it.

use near_sdk::env;

use super::flows::{account, as_caller, setup, skin_of};
use crate::Contract;
use crate::constants::COMMON;
use crate::constants::catalog::{INITIAL_SKIN_CAPS, SKINS, STARTER_SKIN_TEMPLATE, skin_supply_cap};
use crate::types::ItemKind;

const OWNER: &str = "owner.testnet";
const PLAYER: &str = "p-a.game.testnet";

const COMMON_CAP: u32 = match INITIAL_SKIN_CAPS[0] {
    Some(cap) => cap,
    None => 0,
};

/// Mints every common catalog skin except Ember up to its cap, so Ember is the only common a
/// draw could still pick. A fresh context per template keeps each under the 100-log limit.
fn exhaust_other_commons(c: &mut Contract) {
    let others = SKINS
        .iter()
        .filter(|t| t.rarity == COMMON && t.id != STARTER_SKIN_TEMPLATE);
    for t in others {
        as_caller(OWNER, 0, 1);
        for _ in 0..COMMON_CAP {
            c.mint_item(account(OWNER), ItemKind::Skin, t.id, None);
        }
    }
}

#[test]
fn ember_mints_past_the_common_cap() {
    let mut c = setup(PLAYER, false, 0);
    let past_cap = COMMON_CAP + 2;
    for _ in 0..past_cap {
        c.mint_item(account(PLAYER), ItemKind::Skin, STARTER_SKIN_TEMPLATE, None);
    }
    let ember = c
        .get_catalog()
        .skins
        .into_iter()
        .find(|s| s.id == STARTER_SKIN_TEMPLATE)
        .unwrap_or_else(|| panic!("no ember"));
    assert_eq!(ember.minted, past_cap, "Embers are still counted");
}

#[test]
#[should_panic(expected = "no supply")]
fn other_commons_stay_capped() {
    let mut c = setup(PLAYER, false, 0);
    for _ in 0..=COMMON_CAP {
        c.mint_item(account(PLAYER), ItemKind::Skin, 1, None);
    }
}

#[test]
fn packs_never_draw_ember() {
    let mut c = setup(PLAYER, false, 10_000);
    exhaust_other_commons(&mut c);
    let secret = [7u8; 32];
    as_caller(PLAYER, 0, 2);
    let pack = c.open_pack(ItemKind::Skin, 0, env::sha256_array(secret), 1);
    as_caller(PLAYER, 0, 3);
    c.reveal_pack(pack, secret, 2);
    // Slot 1 of a starter pack is always common; Ember has supply but is not a candidate.
    let first = c
        .get_item("s:71".to_string())
        .unwrap_or_else(|| panic!("no item"));
    assert_eq!((first.template, first.rarity), (0, COMMON));
    assert!(first.placeholder_name.is_some());
}

#[test]
fn vendor_drones_never_get_ember() {
    let mut c = setup(PLAYER, false, 10_000);
    exhaust_other_commons(&mut c);
    as_caller(PLAYER, 0, 2);
    let drone = c.vendor_buy_drone(1);
    let skin = c
        .get_item(skin_of(&c, &drone))
        .unwrap_or_else(|| panic!("no skin"));
    assert_eq!((skin.template, skin.rarity), (0, COMMON));
    assert!(skin.placeholder_name.is_some());
}

#[test]
fn catalog_reports_ember_uncapped() {
    let c = setup(PLAYER, false, 0);
    for s in c.get_catalog().skins {
        let expected = if s.id == STARTER_SKIN_TEMPLATE {
            None
        } else {
            INITIAL_SKIN_CAPS[usize::from(s.rarity)]
        };
        assert_eq!(s.cap, expected, "skin {}", s.slug);
    }
}

#[test]
fn supply_cap_is_none_only_for_ember() {
    let caps = &INITIAL_SKIN_CAPS;
    assert_eq!(skin_supply_cap(caps, STARTER_SKIN_TEMPLATE, COMMON), None);
    assert_eq!(skin_supply_cap(caps, 1, COMMON), Some(10));
    assert_eq!(skin_supply_cap(caps, 25, 3), Some(3));
    assert_eq!(
        skin_supply_cap(caps, 1, 9),
        Some(0),
        "an unknown rarity mints nothing"
    );
    assert_eq!(
        skin_supply_cap(&[None, None, None, None], 1, COMMON),
        None,
        "an unlimited rarity has no cap"
    );
}
