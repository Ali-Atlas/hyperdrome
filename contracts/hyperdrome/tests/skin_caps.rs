//! Sandbox tests for the live skin supply caps (SPEC.md 2.6 and 4.4): `set_skin_caps` is owner only,
//! the caps apply to minting and `get_catalog` reports them, and the migration from the T16 deploy.

#[allow(dead_code)] // each test binary uses a subset of the shared helpers
mod common;

use common::batches::ONES;
use common::wallet::{link, wallet_link};
use common::{Env, R, assert_fails, done, events, ok};
use near_api::{AccountId, Contract};
use near_sdk::serde_json::{Value, json};

/// The wasm deployed to game.hyperdrome.testnet by T16 (code hash
/// `9Dz987fhyJ881jh7QoMpwevfaqvYxxdTYQT6pB3niQbX`), read back from testnet with `view_code`. Its
/// contract state is `VersionedState::V2`.
const T16_WASM: &[u8] = include_bytes!("fixtures/hyperdrome-t16.wasm");
const T16_WASM_SHA256: &str = "7a3112d5dcb6405dd961cf999721e7d6bb6bd53a000900d38404895e8b4c6686";

/// A common catalog skin other than Ember.
const COMMON_SKIN: u16 = 1;
/// Ember, the uncapped starter skin.
const EMBER: u16 = 4;
/// A legendary catalog skin.
const LEGENDARY_SKIN: u16 = 25;

fn skin(owner: &AccountId, template: u16) -> Value {
    json!({ "owner": owner, "kind": "skin", "template": template, "placeholder_name": null })
}

/// The caps `get_catalog` reports for a template and its minted count.
async fn catalog_entry(env: &Env, template: u16) -> R<(Value, u64)> {
    let catalog: Value = env.view("get_catalog", json!({})).await?;
    let entry = catalog["skins"]
        .as_array()
        .and_then(|skins| skins.iter().find(|s| s["id"] == template))
        .unwrap_or_else(|| panic!("no skin {template}"));
    Ok((entry["cap"].clone(), entry["minted"].as_u64().unwrap_or(0)))
}

async fn set_caps(env: &Env, caps: Value) {
    done(
        env.call(&env.owner, "set_skin_caps", json!({ "caps": caps }))
            .await,
    );
}

#[tokio::test]
async fn set_skin_caps_is_owner_only_and_get_catalog_reports_it() -> R<()> {
    let env = Env::start().await?;
    let args = json!({ "caps": [1, 2, 3, 4] });
    assert_fails(
        env.call(&env.stranger, "set_skin_caps", args.clone()).await,
        "not owner",
    );
    assert_fails(
        env.call(&env.game, "set_skin_caps", args).await,
        "not owner",
    );
    assert_eq!(catalog_entry(&env, COMMON_SKIN).await?.0, json!(10));

    let out = ok(env
        .call(
            &env.owner,
            "set_skin_caps",
            json!({ "caps": [2200, 1300, 1100, 3] }),
        )
        .await)?;
    assert!(events(&out).is_empty(), "set_skin_caps emits nothing");
    assert_eq!(catalog_entry(&env, COMMON_SKIN).await?.0, json!(2200));
    assert_eq!(catalog_entry(&env, 9).await?.0, json!(1300));
    assert_eq!(catalog_entry(&env, 17).await?.0, json!(1100));
    assert_eq!(catalog_entry(&env, LEGENDARY_SKIN).await?.0, json!(3));
    assert_eq!(
        catalog_entry(&env, EMBER).await?.0,
        Value::Null,
        "Ember stays uncapped"
    );

    set_caps(&env, json!([null, 6, 4, 3])).await;
    assert_eq!(
        catalog_entry(&env, COMMON_SKIN).await?.0,
        Value::Null,
        "null is unlimited"
    );
    Ok(())
}

#[tokio::test]
async fn caps_apply_to_minting() -> R<()> {
    let env = Env::start().await?;
    let owner = env.stranger.clone();
    set_caps(&env, json!([1, 6, 4, 3])).await;

    let args = skin(&owner, COMMON_SKIN);
    done(env.call(&env.owner, "mint_item", args.clone()).await);
    assert_fails(
        env.call(&env.owner, "mint_item", args.clone()).await,
        "no supply",
    );

    set_caps(&env, json!([2, 6, 4, 3])).await;
    done(env.call(&env.owner, "mint_item", args.clone()).await);
    assert_fails(
        env.call(&env.owner, "mint_item", args.clone()).await,
        "no supply",
    );

    set_caps(&env, json!([null, 6, 4, 3])).await;
    done(env.call(&env.owner, "mint_item", args.clone()).await);
    assert_eq!(catalog_entry(&env, COMMON_SKIN).await?.1, 3);

    // A cap below the minted count stops new mints and leaves what exists.
    set_caps(&env, json!([1, 6, 4, 3])).await;
    assert_fails(env.call(&env.owner, "mint_item", args).await, "no supply");
    assert_eq!(catalog_entry(&env, COMMON_SKIN).await?.1, 3);

    // Ember is not capped by the common rate, and a placeholder never counts against supply.
    done(env.call(&env.owner, "mint_item", skin(&owner, EMBER)).await);
    done(
        env.call(
            &env.owner,
            "mint_item",
            json!({ "owner": owner, "kind": "skin", "template": COMMON_SKIN, "placeholder_name": "Test" }),
        )
        .await,
    );
    assert_eq!(catalog_entry(&env, COMMON_SKIN).await?.1, 3);
    Ok(())
}

#[tokio::test]
async fn migrates_from_the_deployed_t16_code() -> R<()> {
    let digest = near_sdk::env::sha256_array(T16_WASM);
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(hex, T16_WASM_SHA256, "the fixture is the T16 deploy");

    let env = Env::start_with(T16_WASM.to_vec()).await?;
    let p = env.funded_player("pilot", false, 40).await?;
    let drone = env.mint_drone(&p.id, ONES).await?;
    let token = env.mint_item(&p.id, "skin", COMMON_SKIN, None).await?;
    let wallet = env.stranger.clone();
    done(link(&env, &p.id, &wallet).await);

    let migrate = || async {
        Contract::deploy(env.game.clone())
            .use_code(common::wasm())
            .with_init_call("migrate", json!({}))?
            .with_signer(env.signer.clone())
            .send_to(&env.net)
            .await?
            .assert_success();
        R::<()>::Ok(())
    };
    migrate().await?;

    // Every old record is readable through the new layout, at the old caps.
    let player: Value = env.view("get_player", json!({ "account": p.id })).await?;
    assert_eq!(player["seq"], 0);
    assert_eq!(env.volts(&p.id).await?, 40);
    assert_eq!(env.owner_of(&drone).await?, p.id.as_str());
    assert_eq!(env.owner_of(&token).await?, p.id.as_str());
    assert_eq!(wallet_link(&env, &p.id).await?, json!(wallet));
    assert_eq!(catalog_entry(&env, COMMON_SKIN).await?, (json!(10), 1));
    assert_eq!(catalog_entry(&env, LEGENDARY_SKIN).await?.0, json!(3));

    // The new method works, and migrating again keeps the live caps.
    set_caps(&env, json!([2200, 1300, 1100, 3])).await;
    migrate().await?;
    assert_eq!(catalog_entry(&env, COMMON_SKIN).await?, (json!(2200), 1));
    Ok(())
}
