//! Packs, capsules and vendor drones (SPEC.md 2.1, 2.7 and 4.4). Packs are commit-reveal: the
//! buyer commits sha256(secret) in `open_pack` and reveals the secret in a later block; the
//! result mixes in the chain's random seed. Vendor drones roll from the chain seed and the new
//! token id.

use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::{AccountId, env, near, require};

use crate::constants::catalog::{MODS, SKIN_SUPPLY_CAP, SKINS, STARTER_SKIN_TEMPLATE};
use crate::constants::names::{DRONE_NAME_WORDS, PLACEHOLDER_SKIN_NAMES};
use crate::constants::tables::PACK_TIERS;
use crate::constants::{COMMON, DRONE_PREFIX, LEVEL_MIN, PACK_SLOTS, VENDOR_DRONE_PRICE};
use crate::events::Event;
use crate::hashing::{
    VendorRoll, pack_result, pick_index, roll_rarity, slot_draw, vendor_roll, vendor_seed,
};
use crate::player::Payee;
use crate::types::{ItemKind, PackCommit};
use crate::{Contract, ContractExt};

const NAME_LETTERS: u32 = 26;
const NAME_DIGITS: u32 = 10;

/// `WORD-<LETTER><DIGIT>`, the baseline drone name pattern. Not unique; the token id is the
/// identity.
pub fn vendor_name(roll: &VendorRoll) -> String {
    let word = DRONE_NAME_WORDS[pick_index(roll.word, DRONE_NAME_WORDS.len())];
    let letter = char::from(b'A' + u8::try_from(roll.letter % NAME_LETTERS).unwrap_or(0));
    let digit = roll.digit % NAME_DIGITS;
    format!("{word}-{letter}{digit}")
}

#[near]
impl Contract {
    /// Player only (play key). Buys a `kind` pack (skin pack or mod capsule) of `tier` (0 starter,
    /// 1 premium, 2 legendary) and commits `hash` = sha256(secret). The price (SPEC.md 2.7) is
    /// burned; team accounts pass the team cap check. Stores the commit with the current block
    /// height and returns the pack id. Emits nep141 ft_burn and `pack_committed`. Fails with
    /// "paused", "not player", "bad seq", "bad tier", "insufficient volts" or "cap exceeded".
    pub fn open_pack(&mut self, kind: ItemKind, tier: u8, hash: [u8; 32], seq: u64) -> u64 {
        let caller = self.begin_player_action(seq);
        let t = PACK_TIERS
            .get(usize::from(tier))
            .unwrap_or_else(|| env::panic_str("bad tier"));
        let price = match kind {
            ItemKind::Skin => t.skin_pack_price,
            ItemKind::Mod => t.mod_capsule_price,
        };
        self.spend(&caller, price, Payee::Burn("open_pack"));

        let s = self.s_mut();
        let pack_id = s.next_pack;
        s.next_pack += 1;
        let commit = PackCommit {
            buyer: caller.clone(),
            kind,
            tier,
            hash,
            height: env::block_height(),
            revealed: false,
        };
        s.packs.insert(pack_id, commit);
        Event::PackCommitted {
            pack_id,
            buyer: caller,
            kind,
            tier,
        }
        .emit();
        pack_id
    }

    /// Player only (play key), the pack's buyer, in a later block than the commit. Checks
    /// sha256(`secret`) against the commit, derives result = sha256(secret ++ random_seed ++
    /// pack_id LE) and mints 3 items to the buyer: per slot a rarity from the tier odds, then a
    /// template uniform among the rarity's skins with supply left (a placeholder skin with
    /// template 0 and a pool name when none is left) or among all its mods (byte map in SPEC.md
    /// 4.4). Marks the pack revealed. Emits nep171 nft_mint and `item_minted` per item, then
    /// `pack_opened`. Fails with "paused", "not player", "bad seq", "not found", "not owner",
    /// "too early" or "bad reveal" (wrong secret, or already revealed).
    pub fn reveal_pack(&mut self, pack_id: u64, secret: [u8; 32], seq: u64) {
        let caller = self.begin_player_action(seq);
        let pack = self
            .s()
            .packs
            .get(&pack_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("not found"));
        require!(pack.buyer == caller, "not owner");
        require!(!pack.revealed, "bad reveal");
        require!(env::block_height() > pack.height, "too early");
        require!(env::sha256_array(secret) == pack.hash, "bad reveal");
        let tier = PACK_TIERS
            .get(usize::from(pack.tier))
            .unwrap_or_else(|| env::panic_str("bad tier"));

        let result = pack_result(&secret, &env::random_seed(), pack_id);
        let mut tokens = Vec::with_capacity(PACK_SLOTS);
        for i in 0..PACK_SLOTS {
            let draw = slot_draw(&result, i);
            let odds = if i == 0 { tier.slot1 } else { tier.slots23 };
            let rarity = roll_rarity(odds, draw.roll);
            let token =
                self.mint_drawn_item(&caller, pack.kind, rarity, draw.pick, u32::from(draw.name));
            tokens.push(token);
        }
        if let Some(p) = self.s_mut().packs.get_mut(&pack_id) {
            p.revealed = true;
        }
        Event::PackOpened { pack_id, tokens }.emit();
    }

    /// Player only (play key). Buys a level 1 vendor drone for 3,500 Volts, burned; team accounts
    /// pass the team cap check. Stats roll from sha256(random_seed ++ new token id) per SPEC.md
    /// 2.1 and 4.4; the drone gets a `WORD-<LETTER><DIGIT>` name and one common skin (a placeholder
    /// when no common has supply left) and one common mod, both bound and not equipped. Returns
    /// the drone id. Emits nep141 ft_burn, nep171 nft_mint and `drone_minted`, nft_mint and
    /// `item_minted` per item, and `item_bound` twice. Fails with "paused", "not player",
    /// "bad seq", "insufficient volts" or "cap exceeded".
    pub fn vendor_buy_drone(&mut self, seq: u64) -> TokenId {
        let caller = self.begin_player_action(seq);
        self.spend(&caller, VENDOR_DRONE_PRICE, Payee::Burn("vendor_buy_drone"));

        let next_id = format!("{DRONE_PREFIX}{}", self.s().next_drone);
        let roll = vendor_roll(vendor_seed(&env::random_seed(), &next_id), LEVEL_MIN);
        let drone = self.internal_mint_drone(&caller, vendor_name(&roll), LEVEL_MIN, roll.stats);
        let skin = self.mint_drawn_item(
            &caller,
            ItemKind::Skin,
            COMMON,
            roll.skin_pick,
            roll.placeholder_pick,
        );
        let module = self.mint_drawn_item(&caller, ItemKind::Mod, COMMON, roll.mod_pick, 0);
        self.internal_bind(&drone, &skin, ItemKind::Skin);
        self.internal_bind(&drone, &module, ItemKind::Mod);
        drone
    }
}

impl Contract {
    /// Mints one item of `kind` and `rarity` to `owner`: a skin uniform (by `pick`) among the
    /// rarity's templates with supply left, Ember excluded (SPEC.md 2.6), else a placeholder skin named from the rarity's pool
    /// (by `name_pick`); a mod uniform among all the rarity's templates.
    fn mint_drawn_item(
        &mut self,
        owner: &AccountId,
        kind: ItemKind,
        rarity: u8,
        pick: u32,
        name_pick: u32,
    ) -> TokenId {
        let cap = SKIN_SUPPLY_CAP
            .get(usize::from(rarity))
            .copied()
            .unwrap_or(0);
        let candidates: Vec<u16> = match kind {
            ItemKind::Skin => SKINS
                .iter()
                .filter(|t| t.rarity == rarity && t.id != STARTER_SKIN_TEMPLATE)
                .filter(|t| self.s().skin_minted.get(&t.id).copied().unwrap_or(0) < cap)
                .map(|t| t.id)
                .collect(),
            ItemKind::Mod => MODS
                .iter()
                .filter(|t| t.rarity == rarity)
                .map(|t| t.id)
                .collect(),
        };
        if let Some(&template) = candidates.get(pick_index(pick, candidates.len())) {
            return self.internal_mint_item(owner, kind, template, rarity, None);
        }
        require!(kind == ItemKind::Skin, "bad template");
        let pool = PLACEHOLDER_SKIN_NAMES
            .get(usize::from(rarity))
            .unwrap_or_else(|| env::panic_str("bad template"));
        let name = pool[pick_index(name_pick, pool.len())].to_string();
        self.internal_mint_item(owner, kind, 0, rarity, Some(name))
    }
}
