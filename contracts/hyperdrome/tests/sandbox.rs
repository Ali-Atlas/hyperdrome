//! Sandbox tests for the T3 surface (SPEC.md 4 and 13): init, migrate, create_player, mints and
//! events, standard views, the bound-item transfer rules and access control.

mod common;

use common::{Env, R, assert_fails, done, event, events, ok, tgas};
use near_api::types::AccessKeyPermission;
use near_api::{Contract, NearToken};
use near_sdk::serde_json::{Value, json};

const CREATE_PLAYER_BUDGET_TGAS: f64 = 40.0;
const MINT_DRONE_BUDGET_TGAS: f64 = 10.0;
const PLAYER_ACTION_BUDGET_TGAS: f64 = 15.0;
const PLAY_METHODS: [&str; 9] = [
    "allocate_stats",
    "equip",
    "bind",
    "list",
    "buy",
    "cancel",
    "open_pack",
    "reveal_pack",
    "vendor_buy_drone",
];

fn one_yocto() -> NearToken {
    NearToken::from_yoctonear(1)
}

#[tokio::test]
async fn init_metadata_constants_and_owner_access() -> R<()> {
    let env = Env::start().await?;
    let ft: Value = env.view("ft_metadata", json!({})).await?;
    assert_eq!(
        (
            ft["name"].as_str(),
            ft["symbol"].as_str(),
            ft["decimals"].as_u64()
        ),
        (Some("Volts"), Some("VOLT"), Some(0))
    );
    let nft: Value = env.view("nft_metadata", json!({})).await?;
    assert_eq!(
        (
            nft["name"].as_str(),
            nft["symbol"].as_str(),
            nft["spec"].as_str()
        ),
        (Some("Hyperdrome"), Some("HDROME"), Some("nft-1.0.0"))
    );
    assert!(nft["base_uri"].is_null());
    let constants: Value = env.view("get_constants", json!({})).await?;
    assert_eq!(constants["mods"].as_array().map(Vec::len), Some(26));
    assert_eq!(constants["tracks"].as_array().map(Vec::len), Some(16));
    let treasury: Value = env
        .view("storage_balance_of", json!({ "account_id": env.owner }))
        .await?;
    assert!(!treasury.is_null(), "treasury registered for Volts");

    for (method, args) in [
        ("mint_volts", json!({ "to": env.owner, "amount": "1" })),
        (
            "mint_drone",
            json!({ "owner": env.stranger, "name": "x", "level": 1, "stats": ([1u8; 9]), "active_hint": true }),
        ),
        ("register_player", json!({ "account_id": env.stranger })),
        ("set_paused", json!({ "paused": true })),
        ("set_base_uri", json!({ "base_uri": "https://evil.test" })),
        (
            "set_team_budget",
            json!({ "account": env.stranger, "per_tx": "1", "per_day": "1" }),
        ),
    ] {
        assert_fails(env.call(&env.stranger, method, args).await, "not owner");
    }
    let (_, pk) = common::new_key()?;
    let args = json!({ "slug": "abc", "admin_pk": pk, "play_pk": pk, "is_team": false });
    assert_fails(
        env.call(&env.stranger, "create_player", args).await,
        "not owner",
    );

    done(
        env.call(
            &env.owner,
            "set_base_uri",
            json!({ "base_uri": "https://app.test/api/metadata" }),
        )
        .await,
    );
    let nft: Value = env.view("nft_metadata", json!({})).await?;
    assert_eq!(nft["base_uri"], "https://app.test/api/metadata");

    assert_fails(
        env.call(
            &env.owner,
            "new",
            json!({ "owner_id": env.owner, "treasury_id": env.owner }),
        )
        .await,
        "already been initialized",
    );
    assert_fails(
        env.call(
            &env.owner,
            "commit_batch",
            json!({ "batch_id": 1, "seed_hash": ([0u8; 32]), "matchups": [] }),
        )
        .await,
        "private",
    );
    assert_fails(
        env.call(
            &env.game,
            "commit_batch",
            json!({ "batch_id": 1, "seed_hash": ([0u8; 32]), "matchups": [] }),
        )
        .await,
        "not implemented",
    );
    Ok(())
}

#[tokio::test]
async fn migrate_keeps_state_across_redeploy() -> R<()> {
    let env = Env::start().await?;
    let args = json!({ "owner": env.stranger, "name": "Keeper", "level": 2, "stats": ([2u8; 9]), "active_hint": true });
    done(env.call(&env.owner, "mint_drone", args).await);
    Contract::deploy(env.game.clone())
        .use_code(common::wasm())
        .with_init_call("migrate", json!({}))?
        .with_signer(env.signer.clone())
        .send_to(&env.net)
        .await?
        .assert_success();
    let drone: Value = env.view("get_drone", json!({ "token": "d:1" })).await?;
    assert_eq!(
        (drone["owner"].as_str(), drone["cold"]["name"].as_str()),
        (Some("stranger.sandbox"), Some("Keeper"))
    );
    assert_eq!(drone["hot"]["level"], 2);
    let supply: String = env.view("nft_total_supply", json!({})).await?;
    assert_eq!(supply, "1");
    assert_fails(env.call(&env.owner, "migrate", json!({})).await, "private");
    Ok(())
}

#[tokio::test]
async fn create_player_makes_account_with_two_scoped_keys() -> R<()> {
    let env = Env::start().await?;
    let (player, out) = env.create_player("smoke1", false).await?;
    let gas = tgas(&out);
    println!("create_player gas burnt: {gas:.3} TGas");
    assert!(
        gas <= CREATE_PLAYER_BUDGET_TGAS,
        "create_player used {gas} TGas"
    );
    assert!(
        out.clone().json::<bool>()?,
        "callback reports the account was created"
    );

    let keys = env.keys(&player.id).await?;
    assert_eq!(keys.len(), 2, "exactly two keys: {keys:?}");
    let full: Vec<_> = keys
        .iter()
        .filter(|(_, p)| *p == AccessKeyPermission::FullAccess)
        .collect();
    assert_eq!(full.len(), 1);
    assert_eq!(full[0].0, player.admin_pk);
    let fc = keys.iter().find_map(|(pk, p)| match p {
        AccessKeyPermission::FunctionCall(f) => Some((pk, f)),
        AccessKeyPermission::FullAccess => None,
    });
    let (fc_pk, fc) = fc.ok_or("no function-call key")?;
    assert_eq!(fc_pk, &player.play_pk);
    assert_eq!(fc.receiver_id, env.game.to_string());
    assert_eq!(fc.allowance, Some(NearToken::from_near(1)));
    let mut methods = fc.method_names.clone();
    methods.sort();
    let mut expected = PLAY_METHODS.map(String::from).to_vec();
    expected.sort();
    assert_eq!(methods, expected);

    let row: Value = env
        .view("get_player", json!({ "account": player.id }))
        .await?;
    assert_eq!(
        (row["seq"].as_u64(), row["is_team"].as_bool()),
        (Some(0), Some(false))
    );
    let storage: Value = env
        .view("storage_balance_of", json!({ "account_id": player.id }))
        .await?;
    assert!(!storage.is_null(), "player registered for Volts");
    let balance: Value = near_api::Account(player.id.clone())
        .view()
        .fetch_from(&env.net)
        .await
        .map(|d| json!(d.data.amount.as_yoctonear().to_string()))?;
    assert_eq!(
        balance,
        json!(NearToken::from_millinear(50).as_yoctonear().to_string()),
        "funded with 0.05 NEAR"
    );

    let (team, _) = env.create_player("vortex", true).await?;
    assert_eq!(team.id.as_str(), "vortex.game.sandbox");
    let row: Value = env
        .view("get_player", json!({ "account": team.id }))
        .await?;
    assert_eq!(row["is_team"], true);

    let (_, pk) = common::new_key()?;
    for (slug, needle) in [
        ("smoke1", "exists"),
        ("Ab", "bad slug"),
        ("a-b-c", "bad slug"),
    ] {
        let args = json!({ "slug": slug, "admin_pk": pk, "play_pk": pk, "is_team": false });
        assert_fails(env.call(&env.owner, "create_player", args).await, needle);
    }
    // The play key reaches only the play methods and cannot attach deposits.
    let args = json!({ "to": player.id, "amount": "5" });
    assert_fails(
        env.call_with(
            &player.id,
            player.play.clone(),
            "mint_volts",
            args,
            NearToken::from_yoctonear(0),
            common::PLAYER_GAS_TGAS,
        )
        .await,
        "InvalidTransaction",
    );
    let args = json!({ "receiver_id": env.owner, "amount": "1" });
    assert_fails(
        env.call_with(
            &player.id,
            player.play.clone(),
            "ft_transfer",
            args,
            one_yocto(),
            common::PLAYER_GAS_TGAS,
        )
        .await,
        "InvalidTransaction",
    );
    Ok(())
}

#[tokio::test]
async fn mints_emit_events_and_enforce_rules() -> R<()> {
    let env = Env::start().await?;
    let (p, _) = env.create_player("minter", false).await?;
    done(
        env.call(
            &env.owner,
            "set_base_uri",
            json!({ "base_uri": "https://app.test/api/metadata" }),
        )
        .await,
    );

    let args = json!({ "owner": p.id, "name": "Starter", "level": 1, "stats": ([1u8; 9]), "active_hint": true });
    let out = ok(env.call(&env.owner, "mint_drone", args).await)?;
    let gas = tgas(&out);
    println!("mint_drone gas burnt: {gas:.3} TGas");
    assert!(gas <= MINT_DRONE_BUDGET_TGAS, "mint_drone used {gas} TGas");
    assert_eq!(out.clone().json::<String>()?, "d:1");
    let mint = event(&out, "nep171", "nft_mint");
    assert_eq!(
        mint["data"][0],
        json!({ "owner_id": p.id, "token_ids": ["d:1"] })
    );
    let minted = event(&out, "hyperdrome", "drone_minted");
    assert_eq!(
        (minted["version"].as_str(), minted["data"].clone()),
        (
            Some("1.0.0"),
            json!({ "token": "d:1", "owner": p.id, "level": 1 })
        )
    );

    let out = ok(env
        .call(
            &env.owner,
            "mint_item",
            json!({ "owner": p.id, "kind": "skin", "template": 4, "placeholder_name": null }),
        )
        .await)?;
    assert_eq!(
        event(&out, "hyperdrome", "item_minted")["data"],
        json!({ "token": "s:1", "owner": p.id, "kind": "skin", "template": 4, "rarity": 0 })
    );
    event(&out, "nep171", "nft_mint");
    let out = ok(env
        .call(
            &env.owner,
            "mint_item",
            json!({ "owner": p.id, "kind": "mod", "template": 11, "placeholder_name": null }),
        )
        .await)?;
    assert_eq!(
        event(&out, "hyperdrome", "item_minted")["data"]["rarity"],
        1
    );

    let out = ok(env
        .call(
            &env.owner,
            "mint_volts",
            json!({ "to": p.id, "amount": "1000" }),
        )
        .await)?;
    assert_eq!(
        event(&out, "nep141", "ft_mint")["data"][0],
        json!({ "owner_id": p.id, "amount": "1000" })
    );
    let bal: String = env
        .view("ft_balance_of", json!({ "account_id": p.id }))
        .await?;
    assert_eq!(bal, "1000");

    let mint = |level: u8, stats: [u8; 9]| json!({ "owner": p.id, "name": "x", "level": level, "stats": stats, "active_hint": false });
    for (args, needle) in [
        (mint(0, [1; 9]), "bad level"),
        (mint(21, [1; 9]), "bad level"),
        (mint(1, [0, 1, 1, 1, 1, 1, 1, 1, 1]), "bad stat"),
        (mint(1, [15, 1, 1, 1, 1, 1, 1, 1, 1]), "over cap"),
        (mint(1, [14, 14, 1, 1, 1, 1, 1, 1, 1]), "tsb exceeded"),
    ] {
        assert_fails(env.call(&env.owner, "mint_drone", args).await, needle);
    }
    let item = |kind: &str, template: u16, placeholder: Option<&str>| json!({ "owner": p.id, "kind": kind, "template": template, "placeholder_name": placeholder });
    for _ in 0..3 {
        done(
            env.call(&env.owner, "mint_item", item("skin", 25, None))
                .await,
        );
    }
    assert_fails(
        env.call(&env.owner, "mint_item", item("skin", 25, None))
            .await,
        "no supply",
    );
    done(
        env.call(
            &env.owner,
            "mint_item",
            item("skin", 25, Some("Static Ghost")),
        )
        .await,
    );
    for (args, needle) in [
        (item("skin", 0, None), "bad template"),
        (item("skin", 33, None), "bad template"),
        (item("mod", 27, None), "bad template"),
        (item("mod", 1, Some("x")), "bad template"),
    ] {
        assert_fails(env.call(&env.owner, "mint_item", args).await, needle);
    }

    let catalog: Value = env.view("get_catalog", json!({})).await?;
    assert_eq!(
        catalog["skins"][24]["minted"], 3,
        "placeholders do not count against supply"
    );
    let token: Value = env.view("nft_token", json!({ "token_id": "d:1" })).await?;
    assert_eq!(
        token["metadata"]["media"],
        "https://app.test/api/metadata/d:1/image"
    );
    let extra: Value =
        near_sdk::serde_json::from_str(token["metadata"]["extra"].as_str().ok_or("extra")?)?;
    assert_eq!(
        (
            extra["level"].as_u64(),
            extra["elo"].as_i64(),
            extra["tier"].as_u64()
        ),
        (Some(1), Some(1000), Some(1))
    );
    let owned: Vec<Value> = env
        .view("nft_tokens_for_owner", json!({ "account_id": p.id }))
        .await?;
    assert_eq!(owned.len(), 7);
    assert!(owned.iter().all(|t| t["metadata"]["extra"].is_string()));
    let hash: Option<[u8; 32]> = env.view("stats_hash", json!({ "token": "d:1" })).await?;
    assert!(hash.is_some());
    let total: String = env.view("ft_total_supply", json!({})).await?;
    assert_eq!(total, "1000");
    Ok(())
}

#[tokio::test]
async fn bound_items_move_only_with_their_drone() -> R<()> {
    let env = Env::start().await?;
    let (mut a, _) = env.create_player("alpha", false).await?;
    let (mut b, _) = env.create_player("bravo", false).await?;
    done(env.call(&env.owner, "mint_drone", json!({ "owner": a.id, "name": "A1", "level": 1, "stats": ([1u8; 9]), "active_hint": true })).await);
    done(
        env.call(
            &env.owner,
            "mint_item",
            json!({ "owner": a.id, "kind": "skin", "template": 4, "placeholder_name": null }),
        )
        .await,
    );
    done(
        env.call(
            &env.owner,
            "mint_item",
            json!({ "owner": a.id, "kind": "mod", "template": 1, "placeholder_name": null }),
        )
        .await,
    );

    let out = ok(env
        .play(&mut a, "bind", json!({ "drone": "d:1", "item": "s:1" }))
        .await)?;
    let gas = tgas(&out);
    println!("bind gas burnt: {gas:.3} TGas");
    assert!(gas <= PLAYER_ACTION_BUDGET_TGAS, "bind used {gas} TGas");
    assert_eq!(
        event(&out, "hyperdrome", "item_bound")["data"],
        json!({ "drone": "d:1", "item": "s:1" })
    );
    assert_eq!(
        event(&out, "hyperdrome", "equipped")["data"],
        json!({ "drone": "d:1", "kind": "skin", "item": "s:1" })
    );
    let stale = json!({ "drone": "d:1", "item": "m:1", "seq": a.seq });
    assert_fails(
        env.call_with(
            &a.id,
            a.play.clone(),
            "bind",
            stale,
            NearToken::from_yoctonear(0),
            common::PLAYER_GAS_TGAS,
        )
        .await,
        "bad seq",
    );
    done(
        env.play(&mut a, "bind", json!({ "drone": "d:1", "item": "m:1" }))
            .await,
    );
    assert_fails(
        env.play(&mut a, "bind", json!({ "drone": "d:1", "item": "m:1" }))
            .await,
        "bound item",
    );

    let drone: Value = env.view("get_drone", json!({ "token": "d:1" })).await?;
    assert_eq!(
        (
            drone["cold"]["bound_skins"].clone(),
            drone["cold"]["bound_mods"].clone()
        ),
        (json!(["s:1"]), json!(["m:1"]))
    );
    assert_eq!(
        (
            drone["hot"]["equipped_skin"].clone(),
            drone["hot"]["equipped_mod"].clone()
        ),
        (json!("s:1"), json!("m:1"))
    );

    let send =
        |token: &str, to: &near_api::AccountId| json!({ "receiver_id": to, "token_id": token });
    assert_fails(
        env.call_with(
            &a.id,
            a.admin.clone(),
            "nft_transfer",
            send("s:1", &b.id),
            one_yocto(),
            common::PLAYER_GAS_TGAS,
        )
        .await,
        "bound item",
    );
    assert_fails(
        env.call_with(
            &a.id,
            a.admin.clone(),
            "nft_transfer",
            send("d:1", &b.id),
            NearToken::from_yoctonear(0),
            common::PLAYER_GAS_TGAS,
        )
        .await,
        "Requires attached deposit of exactly 1 yoctoNEAR",
    );
    let out = ok(env
        .call_with(
            &a.id,
            a.admin.clone(),
            "nft_transfer",
            send("d:1", &b.id),
            one_yocto(),
            common::PLAYER_GAS_TGAS,
        )
        .await)?;
    let transfer = event(&out, "nep171", "nft_transfer");
    assert_eq!(
        transfer["data"][0]["token_ids"],
        json!(["d:1", "s:1", "m:1"])
    );
    assert_eq!(
        (
            transfer["data"][0]["old_owner_id"].clone(),
            transfer["data"][0]["new_owner_id"].clone()
        ),
        (json!(a.id), json!(b.id))
    );
    assert_eq!(events(&out).len(), 1, "one event for the whole move");
    for t in ["d:1", "s:1", "m:1"] {
        let tok: Value = env.view("nft_token", json!({ "token_id": t })).await?;
        assert_eq!(tok["owner_id"], json!(b.id), "{t} moved with the drone");
    }
    assert_fails(
        env.call_with(
            &b.id,
            b.admin.clone(),
            "nft_transfer",
            send("m:1", &a.id),
            one_yocto(),
            common::PLAYER_GAS_TGAS,
        )
        .await,
        "bound item",
    );

    done(
        env.call(
            &env.owner,
            "mint_item",
            json!({ "owner": a.id, "kind": "mod", "template": 2, "placeholder_name": null }),
        )
        .await,
    );
    assert_fails(
        env.play(&mut a, "bind", json!({ "drone": "d:1", "item": "m:2" }))
            .await,
        "not owner",
    );
    assert_fails(
        env.call(
            &env.stranger,
            "bind",
            json!({ "drone": "d:1", "item": "m:2", "seq": 1 }),
        )
        .await,
        "not player",
    );
    done(
        env.call(&env.owner, "set_paused", json!({ "paused": true }))
            .await,
    );
    assert_fails(
        env.play(&mut b, "bind", json!({ "drone": "d:1", "item": "m:2" }))
            .await,
        "paused",
    );
    done(
        env.call(&env.owner, "set_paused", json!({ "paused": false }))
            .await,
    );
    assert_fails(
        env.play(
            &mut b,
            "allocate_stats",
            json!({ "drone": "d:1", "stats": ([2u8; 9]) }),
        )
        .await,
        "not implemented",
    );
    Ok(())
}
