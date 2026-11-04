//! Mod and skin templates (SPEC.md 2.5 and 2.6). Template ids are 1-based in SPEC order; 0 means
//! "none" in `stats_hash` and settlement snapshots.

use super::{COMMON, EPIC, LEGENDARY, RARE};

/// Stat indices in SPEC.md 2.1 order.
pub const SPEED: u8 = 0;
pub const TURNING: u8 = 1;
pub const ACCELERATION: u8 = 2;
pub const DURABILITY: u8 = 3;
pub const NIGHT_VISION: u8 = 4;
pub const BATTERY: u8 = 5;
pub const RAIN_HANDLING: u8 = 6;
pub const WIND_RESISTANCE: u8 = 7;
pub const CONSISTENCY: u8 = 8;

pub const STAT_NAMES: [&str; 9] = [
    "speed",
    "turning",
    "acceleration",
    "durability",
    "night_vision",
    "battery_capacity",
    "rain_handling",
    "wind_resistance",
    "consistency",
];

pub const RARITY_NAMES: [&str; 4] = ["common", "rare", "epic", "legendary"];

/// A mod template. Legendary mods have a special instead of a bonus stat.
pub struct ModTemplate {
    pub id: u16,
    pub name: &'static str,
    pub rarity: u8,
    pub bonus_stat: Option<u8>,
    pub bonus_pct: u8,
    pub penalty_stat: u8,
    pub penalty_pct: u8,
    pub special: Option<&'static str>,
}

pub const SPECIAL_PHANTOM_DRIVE: &str = "phantom_drive";
pub const SPECIAL_QUANTUM_SYNC: &str = "quantum_sync";
pub const SPECIAL_STORM_RIDER: &str = "storm_rider";

const fn stat_mod(
    id: u16,
    name: &'static str,
    rarity: u8,
    bonus: (u8, u8),
    penalty: (u8, u8),
) -> ModTemplate {
    ModTemplate {
        id,
        name,
        rarity,
        bonus_stat: Some(bonus.0),
        bonus_pct: bonus.1,
        penalty_stat: penalty.0,
        penalty_pct: penalty.1,
        special: None,
    }
}

const fn special_mod(
    id: u16,
    name: &'static str,
    special: &'static str,
    penalty: (u8, u8),
) -> ModTemplate {
    ModTemplate {
        id,
        name,
        rarity: LEGENDARY,
        bonus_stat: None,
        bonus_pct: 0,
        penalty_stat: penalty.0,
        penalty_pct: penalty.1,
        special: Some(special),
    }
}

pub const MODS: [ModTemplate; 26] = [
    stat_mod(1, "Streamline Plate", COMMON, (SPEED, 2), (TURNING, 1)),
    stat_mod(2, "Grip Pads", COMMON, (TURNING, 2), (SPEED, 1)),
    stat_mod(3, "Quick Charge", COMMON, (BATTERY, 2), (DURABILITY, 1)),
    stat_mod(
        4,
        "Shock Absorber",
        COMMON,
        (DURABILITY, 2),
        (ACCELERATION, 1),
    ),
    stat_mod(5, "Steady Module", COMMON, (CONSISTENCY, 2), (SPEED, 1)),
    stat_mod(
        6,
        "Night Lens",
        COMMON,
        (NIGHT_VISION, 2),
        (RAIN_HANDLING, 1),
    ),
    stat_mod(
        7,
        "Rain Shield",
        COMMON,
        (RAIN_HANDLING, 2),
        (WIND_RESISTANCE, 1),
    ),
    stat_mod(
        8,
        "Wind Fin",
        COMMON,
        (WIND_RESISTANCE, 2),
        (NIGHT_VISION, 1),
    ),
    stat_mod(9, "Light Frame", COMMON, (ACCELERATION, 2), (DURABILITY, 1)),
    stat_mod(10, "Tracker Coil", COMMON, (TURNING, 2), (BATTERY, 1)),
    stat_mod(11, "Aero Shell", RARE, (SPEED, 4), (TURNING, 2)),
    stat_mod(12, "Grip Coating", RARE, (TURNING, 4), (ACCELERATION, 2)),
    stat_mod(13, "Storm Plating", RARE, (RAIN_HANDLING, 4), (SPEED, 2)),
    stat_mod(14, "Night Optics", RARE, (NIGHT_VISION, 4), (BATTERY, 2)),
    stat_mod(
        15,
        "Turbo Intake",
        RARE,
        (ACCELERATION, 4),
        (CONSISTENCY, 2),
    ),
    stat_mod(16, "Endurance Core", RARE, (BATTERY, 4), (SPEED, 2)),
    stat_mod(
        17,
        "Aileron Kit",
        RARE,
        (WIND_RESISTANCE, 4),
        (ACCELERATION, 2),
    ),
    stat_mod(18, "Stabilizer Brace", RARE, (CONSISTENCY, 4), (SPEED, 2)),
    stat_mod(19, "Plasma Core", EPIC, (ACCELERATION, 6), (CONSISTENCY, 4)),
    stat_mod(20, "Stealth Aero", EPIC, (SPEED, 6), (DURABILITY, 4)),
    stat_mod(21, "Typhoon Module", EPIC, (RAIN_HANDLING, 8), (SPEED, 5)),
    stat_mod(22, "Predator Lens", EPIC, (NIGHT_VISION, 8), (BATTERY, 5)),
    stat_mod(23, "Iron Hull", EPIC, (DURABILITY, 7), (TURNING, 4)),
    special_mod(
        24,
        "Phantom Drive",
        SPECIAL_PHANTOM_DRIVE,
        (WIND_RESISTANCE, 5),
    ),
    special_mod(25, "Quantum Sync", SPECIAL_QUANTUM_SYNC, (SPEED, 4)),
    special_mod(26, "Storm Rider", SPECIAL_STORM_RIDER, (ACCELERATION, 6)),
];

/// A catalog skin. `file` is the image name under `public/skins/<rarity>/`.
pub struct SkinTemplate {
    pub id: u16,
    pub slug: &'static str,
    pub rarity: u8,
    pub file: &'static str,
}

const fn skin(id: u16, slug: &'static str, rarity: u8) -> SkinTemplate {
    SkinTemplate {
        id,
        slug,
        rarity,
        file: slug,
    }
}

pub const SKINS: [SkinTemplate; 32] = [
    skin(1, "bone", COMMON),
    skin(2, "cobalt", COMMON),
    skin(3, "dusk", COMMON),
    skin(4, "ember", COMMON),
    skin(5, "frost", COMMON),
    skin(6, "rust", COMMON),
    skin(7, "shadow", COMMON),
    skin(8, "venom", COMMON),
    skin(9, "anodized_blaze", RARE),
    skin(10, "arctic_fury", RARE),
    skin(11, "chrome_fury", RARE),
    skin(12, "copper_king", RARE),
    skin(13, "gunmetal_storm", RARE),
    skin(14, "jade_circuit", RARE),
    skin(15, "midnight_oil", RARE),
    skin(16, "titanium_ghost", RARE),
    skin(17, "crystal_phantom", EPIC),
    skin(18, "dragon_scale", EPIC),
    skin(19, "frozen_abyss", EPIC),
    skin(20, "iridescent_wraith", EPIC),
    skin(21, "liquid_mercury", EPIC),
    skin(22, "obsidian_core", EPIC),
    skin(23, "solar_flare", EPIC),
    skin(24, "void_bloom", EPIC),
    skin(25, "apex_predator", LEGENDARY),
    skin(26, "celestial", LEGENDARY),
    SkinTemplate {
        id: 27,
        slug: "diamond_hands",
        rarity: LEGENDARY,
        file: "diamond_hand",
    },
    skin(28, "gilded_throne", LEGENDARY),
    skin(29, "kraken", LEGENDARY),
    skin(30, "necromancer", LEGENDARY),
    skin(31, "samurai", LEGENDARY),
    skin(32, "valiant", LEGENDARY),
];

/// Ember, the starter kit skin (SPEC.md 2.2).
pub const STARTER_SKIN_TEMPLATE: u16 = 4;

/// Per-template supply caps by rarity (common, rare, epic, legendary).
pub const SKIN_SUPPLY_CAP: [u32; 4] = [10, 6, 4, 3];

/// Non-legendary skins that have a render, as (template id, drone tier). Legendary skins equip on
/// any tier; every other skin equips only where listed here (SPEC.md 2.6).
pub const SKIN_TIER_RENDERS: [(u16, u8); 6] = [(4, 1), (11, 4), (17, 4), (18, 4), (19, 4), (22, 4)];

/// Supply cap of a catalog skin template of `rarity`: `None` (uncapped) for Ember, the starter
/// skin (SPEC.md 2.6); 0 for an unknown rarity, so nothing of it can be minted.
pub fn skin_supply_cap(template: u16, rarity: u8) -> Option<u32> {
    if template == STARTER_SKIN_TEMPLATE {
        return None;
    }
    Some(
        SKIN_SUPPLY_CAP
            .get(usize::from(rarity))
            .copied()
            .unwrap_or(0),
    )
}

/// Looks up a mod template by 1-based id.
pub fn mod_template(id: u16) -> Option<&'static ModTemplate> {
    MODS.get(usize::from(id).checked_sub(1)?)
}

/// Looks up a skin template by 1-based id.
pub fn skin_template(id: u16) -> Option<&'static SkinTemplate> {
    SKINS.get(usize::from(id).checked_sub(1)?)
}
