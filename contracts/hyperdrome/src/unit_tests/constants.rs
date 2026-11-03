use crate::constants::catalog::{
    BATTERY, MODS, SKIN_SUPPLY_CAP, SKINS, SPEED, STARTER_SKIN_TEMPLATE, TURNING, WIND_RESISTANCE,
    mod_template, skin_template,
};
use crate::constants::tables::{PACK_TIERS, POW10, SUBTYPES, TRACKS};
use crate::constants::{COMMON, EPIC, LEGENDARY, PLAY_KEY_METHODS, RARE};
use crate::constants_view::Constants;
use crate::owner::valid_slug;
use crate::player::skin_equippable;
use crate::types::{Item, ItemKind};

#[test]
fn mod_templates_are_one_based_in_spec_order() {
    assert_eq!(MODS.len(), 26);
    for (i, m) in MODS.iter().enumerate() {
        assert_eq!(usize::from(m.id), i + 1);
    }
    assert!(mod_template(0).is_none());
    assert!(mod_template(27).is_none());
    let first = mod_template(1).expect("mod 1");
    assert_eq!(
        (first.name, first.rarity, first.bonus_stat, first.bonus_pct),
        ("Streamline Plate", COMMON, Some(SPEED), 2)
    );
    assert_eq!((first.penalty_stat, first.penalty_pct), (TURNING, 1));
    let tracker = mod_template(10).expect("mod 10");
    assert_eq!(
        (tracker.name, tracker.penalty_stat),
        ("Tracker Coil", BATTERY)
    );
    let aero = mod_template(11).expect("mod 11");
    assert_eq!(
        (aero.name, aero.rarity, aero.bonus_pct, aero.penalty_pct),
        ("Aero Shell", RARE, 4, 2)
    );
    let typhoon = mod_template(21).expect("mod 21");
    assert_eq!(
        (
            typhoon.name,
            typhoon.rarity,
            typhoon.bonus_pct,
            typhoon.penalty_pct
        ),
        ("Typhoon Module", EPIC, 8, 5)
    );
    let phantom = mod_template(24).expect("mod 24");
    assert_eq!(
        (phantom.name, phantom.rarity, phantom.bonus_stat),
        ("Phantom Drive", LEGENDARY, None)
    );
    assert_eq!(
        (phantom.penalty_stat, phantom.penalty_pct, phantom.special),
        (WIND_RESISTANCE, 5, Some("phantom_drive"))
    );
    let counts =
        [COMMON, RARE, EPIC, LEGENDARY].map(|r| MODS.iter().filter(|m| m.rarity == r).count());
    assert_eq!(counts, [10, 8, 5, 3]);
}

#[test]
fn skin_templates_are_one_based_eight_per_rarity() {
    assert_eq!(SKINS.len(), 32);
    for (i, s) in SKINS.iter().enumerate() {
        assert_eq!(usize::from(s.id), i + 1);
        assert_eq!(s.rarity, u8::try_from(i / 8).expect("rarity"));
    }
    assert_eq!(
        skin_template(STARTER_SKIN_TEMPLATE).expect("ember").slug,
        "ember"
    );
    let diamond = skin_template(27).expect("skin 27");
    assert_eq!(
        (diamond.slug, diamond.file),
        ("diamond_hands", "diamond_hand")
    );
    assert!(skin_template(0).is_none() && skin_template(33).is_none());
    assert_eq!(SKIN_SUPPLY_CAP, [10, 6, 4, 3]);
}

#[test]
fn tracks_match_spec() {
    assert_eq!(TRACKS.len(), 16);
    let grid = &TRACKS[3];
    assert_eq!(
        (grid.name, grid.difficulty, grid.straights, grid.turns),
        ("The Grid", 3, 4, 4)
    );
    let tempest = &TRACKS[15];
    assert_eq!(
        (
            tempest.name,
            tempest.min_level,
            tempest.max_level,
            tempest.difficulty
        ),
        ("Tempest Run", 16, 20, 10)
    );
    let with_art: Vec<u8> = TRACKS.iter().filter(|t| t.has_art).map(|t| t.id).collect();
    assert_eq!(with_art, vec![0, 1, 2, 3, 4, 5, 8, 12, 15]);
}

#[test]
fn pack_odds_sum_to_one() {
    for p in &PACK_TIERS {
        assert_eq!(
            p.slot1.iter().map(|(_, bp)| u32::from(*bp)).sum::<u32>(),
            10_000,
            "{}",
            p.name
        );
        assert_eq!(
            p.slots23.iter().map(|(_, bp)| u32::from(*bp)).sum::<u32>(),
            10_000,
            "{}",
            p.name
        );
    }
    assert_eq!(PACK_TIERS[2].slot1, &[(LEGENDARY, 4_500), (EPIC, 5_500)]);
    assert_eq!(
        (
            PACK_TIERS[1].skin_pack_price,
            PACK_TIERS[1].mod_capsule_price
        ),
        (12_000, 6_000)
    );
}

#[test]
fn engine_subtype_weights_sum_to_one() {
    for s in &SUBTYPES {
        assert_eq!(
            s.weights_milli
                .iter()
                .map(|(_, w)| u32::from(*w))
                .sum::<u32>(),
            1_000,
            "{}",
            s.name
        );
    }
}

#[test]
fn pow10_table_has_33_entries_from_1_to_100() {
    assert_eq!(POW10.len(), 33);
    assert_eq!(
        (POW10[0], POW10[16], POW10[32]),
        (1_000_000, 10_000_000, 100_000_000)
    );
    assert!(POW10.windows(2).all(|w| w[0] < w[1]));
}

#[test]
fn constants_view_serializes_every_table() {
    let json = near_sdk::serde_json::to_value(Constants::build()).expect("json");
    assert_eq!(json["mods"].as_array().map(Vec::len), Some(26));
    assert_eq!(json["skins"].as_array().map(Vec::len), Some(32));
    assert_eq!(json["tracks"].as_array().map(Vec::len), Some(16));
    assert_eq!(json["economy"]["packs"].as_array().map(Vec::len), Some(3));
    assert_eq!(json["engine"]["subtypes"].as_array().map(Vec::len), Some(7));
    assert_eq!(json["elo_pow10"].as_array().map(Vec::len), Some(33));
    assert_eq!(json["drones"]["vendor_price"], "3500");
}

#[test]
fn play_key_methods_match_spec() {
    let methods: Vec<&str> = PLAY_KEY_METHODS.split(',').collect();
    assert_eq!(
        methods,
        [
            "allocate_stats",
            "equip",
            "bind",
            "list",
            "buy",
            "cancel",
            "open_pack",
            "reveal_pack",
            "vendor_buy_drone"
        ]
    );
}

#[test]
fn slugs() {
    assert!(valid_slug("abc") && valid_slug("a1b2c3d4e5f6g7h8i9j0"));
    for bad in [
        "ab",
        "a1b2c3d4e5f6g7h8i9j0k",
        "Abc",
        "a-b",
        "a.b",
        "a_b",
        "",
    ] {
        assert!(!valid_slug(bad), "{bad}");
    }
}

#[test]
fn skin_equip_tier_rule() {
    let skin = |template: u16, rarity: u8, placeholder: bool| Item {
        kind: ItemKind::Skin,
        template,
        rarity,
        bound_to: None,
        placeholder_name: placeholder.then(|| "Glitch".to_string()),
    };
    assert!(
        skin_equippable(&skin(4, COMMON, false), 1),
        "ember on tier 1"
    );
    assert!(
        !skin_equippable(&skin(4, COMMON, false), 6),
        "ember not on tier 2"
    );
    assert!(
        skin_equippable(&skin(11, RARE, false), 16),
        "chrome_fury on tier 4"
    );
    assert!(
        !skin_equippable(&skin(11, RARE, false), 15),
        "chrome_fury not on tier 3"
    );
    assert!(
        !skin_equippable(&skin(1, COMMON, false), 1),
        "bone has no render"
    );
    assert!(
        skin_equippable(&skin(25, LEGENDARY, false), 3),
        "legendary on any tier"
    );
    assert!(
        skin_equippable(&skin(25, LEGENDARY, true), 3),
        "legendary placeholder on any tier"
    );
    assert!(
        !skin_equippable(&skin(4, COMMON, true), 1),
        "common placeholder has no render"
    );
}
