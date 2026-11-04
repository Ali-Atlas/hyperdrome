//! Owner methods (SPEC.md 4.4). Every method requires `predecessor == owner_id` and takes no
//! deposit, so the owner's ops function-call key can call it.

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::non_fungible_token::TokenId;
use near_contract_standards::non_fungible_token::events::NftMint;
use near_sdk::json_types::U128;
use near_sdk::{AccountId, Allowance, Gas, NearToken, Promise, PublicKey, env, near, require};

use crate::constants::catalog::{mod_template, skin_supply_cap, skin_template};
use crate::constants::{
    DAY_MS, DRONE_PREFIX, LEVEL_CAP, LEVEL_MIN, MOD_PREFIX, PLAY_KEY_ALLOWANCE_YOCTO,
    PLAY_KEY_METHODS, PLAYER_ACCOUNT_BALANCE_YOCTO, PLAYER_PREFIX, SKIN_PREFIX, SLUG_MAX_LEN,
    SLUG_MIN_LEN, START_ELO, STAT_MIN,
};
use crate::events::Event;
use crate::math::{stat_cap, stat_sum, tsb};
use crate::types::{
    DroneCold, DroneHot, Item, ItemKind, Player, TeamBudget, VersionedDroneCold, VersionedDroneHot,
    VersionedItem, VersionedPlayer,
};
use crate::{Contract, ContractExt};

const GAS_FOR_ON_PLAYER_CREATED: Gas = Gas::from_tgas(5);
/// Max bytes read from the account-creation promise result (it returns nothing).
const CREATE_RESULT_MAX_LEN: usize = 16;

/// Slugs are 3 to 20 lowercase letters or digits.
pub fn valid_slug(slug: &str) -> bool {
    (SLUG_MIN_LEN..=SLUG_MAX_LEN).contains(&slug.len())
        && slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

/// `p-<slug>.<contract>` for a player, `<slug>.<contract>` for a team.
fn player_account_id(slug: &str, is_team: bool) -> AccountId {
    let prefix = if is_team { "" } else { PLAYER_PREFIX };
    format!("{prefix}{slug}.{}", env::current_account_id())
        .parse()
        .unwrap_or_else(|_| env::panic_str("bad slug"))
}

#[near]
impl Contract {
    /// Owner only. Creates the player (or team) sub-account of this contract in one promise
    /// batch: CreateAccount, Transfer 0.05 NEAR from the contract balance, AddKey full-access
    /// `admin_pk`, AddKey function-call `play_pk` (receiver this contract, the play methods, 1 NEAR
    /// allowance). The callback registers the player. Fails with "not owner", "bad slug" or
    /// "exists"; returns false from the callback if account creation failed.
    pub fn create_player(
        &mut self,
        slug: String,
        admin_pk: PublicKey,
        play_pk: PublicKey,
        is_team: bool,
    ) -> Promise {
        self.assert_owner();
        require!(valid_slug(&slug), "bad slug");
        let account_id = player_account_id(&slug, is_team);
        require!(self.player(&account_id).is_none(), "exists");
        let allowance = Allowance::limited(NearToken::from_yoctonear(PLAY_KEY_ALLOWANCE_YOCTO))
            .unwrap_or_else(|| env::panic_str("bad allowance"));
        Promise::new(account_id.clone())
            .create_account()
            .transfer(NearToken::from_yoctonear(PLAYER_ACCOUNT_BALANCE_YOCTO))
            .add_full_access_key(admin_pk)
            .add_access_key_allowance(
                play_pk,
                allowance,
                env::current_account_id(),
                PLAY_KEY_METHODS,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_ON_PLAYER_CREATED)
                    .with_unused_gas_weight(0)
                    .on_player_created(account_id, is_team),
            )
    }

    /// Callback of `create_player`. Callable only by this contract. Registers the player when the
    /// account was created; returns whether it was.
    #[private]
    pub fn on_player_created(&mut self, account_id: AccountId, is_team: bool) -> bool {
        let created = env::promise_result_checked(0, CREATE_RESULT_MAX_LEN).is_ok();
        if created {
            self.internal_register_player(&account_id, is_team);
        }
        created
    }

    /// Owner only. Registers `account_id` for Volts storage (contract pays) and adds its Player
    /// row with seq 0. Idempotent: an existing player is left unchanged. Fails with "not owner".
    pub fn register_player(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.internal_register_player(&account_id, false);
    }

    /// Owner only. Mints drone `d:<n>` to `owner` at `level` with `stats`, ELO 1000. Emits nep171
    /// nft_mint and `drone_minted`. `active_hint` is accepted for the API and not stored (active
    /// flags live in the database). Fails with "not owner", "bad level", "bad stat", "over cap" or
    /// "tsb exceeded".
    pub fn mint_drone(
        &mut self,
        owner: AccountId,
        name: String,
        level: u8,
        stats: [u8; 9],
        active_hint: bool,
    ) -> TokenId {
        self.assert_owner();
        let _ = active_hint;
        require!((LEVEL_MIN..=LEVEL_CAP).contains(&level), "bad level");
        let cap = stat_cap(level);
        require!(stats.iter().all(|&s| s >= STAT_MIN), "bad stat");
        require!(stats.iter().all(|&s| s <= cap), "over cap");
        require!(stat_sum(&stats) <= tsb(level), "tsb exceeded");
        self.internal_mint_drone(&owner, name, level, stats)
    }

    /// Owner only. Mints skin `s:<n>` or mod `m:<n>` of `template` to `owner`. A catalog skin
    /// counts against its template's supply cap, except Ember (template 4), which is uncapped. A
    /// placeholder skin (`placeholder_name` set) takes its rarity from `template`, is stored with
    /// template 0 and does not count against supply.
    /// Emits nep171 nft_mint and `item_minted`. Fails with "not owner", "bad template" (unknown
    /// template, or a placeholder name on a mod) or "no supply".
    pub fn mint_item(
        &mut self,
        owner: AccountId,
        kind: ItemKind,
        template: u16,
        placeholder_name: Option<String>,
    ) -> TokenId {
        self.assert_owner();
        let rarity = match kind {
            ItemKind::Skin => skin_template(template).map(|t| t.rarity),
            ItemKind::Mod if placeholder_name.is_none() => mod_template(template).map(|t| t.rarity),
            ItemKind::Mod => None,
        }
        .unwrap_or_else(|| env::panic_str("bad template"));
        self.internal_mint_item(&owner, kind, template, rarity, placeholder_name)
    }

    /// Owner only. Mints `amount` Volts to `to`, which must be registered. Emits nep141 ft_mint.
    /// Fails with "not owner" or if `to` is not registered.
    pub fn mint_volts(&mut self, to: AccountId, amount: U128) {
        self.assert_owner();
        self.s_mut().volts.internal_deposit(&to, amount.0);
        FtMint {
            owner_id: &to,
            amount,
            memo: None,
        }
        .emit();
    }

    /// Owner only. Sets an AI team's per-transaction and per-day Volt caps, keeping the amount
    /// already spent today. Fails with "not owner".
    pub fn set_team_budget(&mut self, account: AccountId, per_tx: U128, per_day: U128) {
        self.assert_owner();
        let today = u32::try_from(env::block_timestamp_ms() / DAY_MS).unwrap_or(u32::MAX);
        let teams = &mut self.s_mut().teams;
        let (spent, day) = teams.get(&account).map_or((0, today), |b| (b.spent, b.day));
        teams.insert(
            account,
            TeamBudget {
                per_tx: per_tx.0,
                per_day: per_day.0,
                spent,
                day,
            },
        );
    }

    /// Owner only. Pauses or resumes every player method. Fails with "not owner".
    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.s_mut().paused = paused;
    }

    /// Owner only. Sets `nft_metadata.base_uri` (the app's `/api/metadata` URL); token `media`
    /// becomes `<base_uri>/<token_id>/image`. `None` clears it. Fails with "not owner".
    pub fn set_base_uri(&mut self, base_uri: Option<String>) {
        self.assert_owner();
        let s = self.s_mut();
        let mut meta = s
            .nft_meta
            .get()
            .unwrap_or_else(|| env::panic_str("no metadata"));
        meta.base_uri = base_uri;
        s.nft_meta.set(&meta);
    }
}

impl Contract {
    pub(crate) fn internal_register_player(&mut self, account_id: &AccountId, is_team: bool) {
        let now = env::block_timestamp_ms();
        let s = self.s_mut();
        if !s.players.contains_key(account_id) {
            let player = Player {
                seq: 0,
                created_at_ms: now,
                is_team,
            };
            s.players
                .insert(account_id.clone(), VersionedPlayer::V1(player));
        }
        if !s.volts.accounts.contains_key(account_id) {
            s.volts.internal_register_account(account_id);
        }
    }

    /// Mints drone `d:<n>` to `owner` at `level` with `stats`, ELO 1000, nothing bound. Emits
    /// nep171 nft_mint and `drone_minted`. Callers validate level and stats.
    pub(crate) fn internal_mint_drone(
        &mut self,
        owner: &AccountId,
        name: String,
        level: u8,
        stats: [u8; 9],
    ) -> TokenId {
        let s = self.s_mut();
        let token_id = format!("{DRONE_PREFIX}{}", s.next_drone);
        s.next_drone += 1;
        s.nft
            .internal_mint_with_refund(token_id.clone(), owner.clone(), None, None);
        let hot = DroneHot {
            level,
            xp: 0,
            elo: START_ELO,
            wins: 0,
            losses: 0,
            equipped_mod: None,
            equipped_skin: None,
            in_batch: None,
        };
        let cold = DroneCold {
            stats,
            bound_skins: vec![],
            bound_mods: vec![],
            invested: 0,
            name,
        };
        s.drones_hot
            .insert(token_id.clone(), VersionedDroneHot::V1(hot));
        s.drones_cold
            .insert(token_id.clone(), VersionedDroneCold::V1(cold));
        NftMint {
            owner_id: owner,
            token_ids: &[&token_id],
            memo: None,
        }
        .emit();
        Event::DroneMinted {
            token: token_id.clone(),
            owner: owner.clone(),
            level,
        }
        .emit();
        token_id
    }

    /// Mints skin `s:<n>` or mod `m:<n>` to `owner`. A catalog skin (no placeholder name) is
    /// counted in `skin_minted` and checked against its template's supply cap ("no supply"), which
    /// Ember does not have (SPEC.md 2.6); a placeholder skin is stored with template
    /// 0 and `rarity`. Emits nep171 nft_mint and `item_minted`. Callers validate template and
    /// rarity.
    pub(crate) fn internal_mint_item(
        &mut self,
        owner: &AccountId,
        kind: ItemKind,
        template: u16,
        rarity: u8,
        placeholder_name: Option<String>,
    ) -> TokenId {
        let s = self.s_mut();
        if kind == ItemKind::Skin && placeholder_name.is_none() {
            let minted = s.skin_minted.get(&template).copied().unwrap_or(0);
            if let Some(cap) = skin_supply_cap(template, rarity) {
                require!(minted < cap, "no supply");
            }
            s.skin_minted.insert(template, minted + 1);
        }
        let template = if placeholder_name.is_some() {
            0
        } else {
            template
        };
        let token_id = match kind {
            ItemKind::Skin => {
                s.next_skin += 1;
                format!("{SKIN_PREFIX}{}", s.next_skin - 1)
            }
            ItemKind::Mod => {
                s.next_mod += 1;
                format!("{MOD_PREFIX}{}", s.next_mod - 1)
            }
        };
        s.nft
            .internal_mint_with_refund(token_id.clone(), owner.clone(), None, None);
        let item = Item {
            kind,
            template,
            rarity,
            bound_to: None,
            placeholder_name,
        };
        s.items.insert(token_id.clone(), VersionedItem::V1(item));
        NftMint {
            owner_id: owner,
            token_ids: &[&token_id],
            memo: None,
        }
        .emit();
        Event::ItemMinted {
            token: token_id.clone(),
            owner: owner.clone(),
            kind,
            template,
            rarity,
        }
        .emit();
        token_id
    }
}
