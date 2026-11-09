//! Sandbox tests for linked wallets and withdrawals (SPEC.md 4.4 and 13): `link_wallet`,
//! `unlink_wallet`, `withdraw` from the owner and from the wallet, every panic that guards
//! ownership or money, a drone arriving with its bound items, the max-tokens budget, and the
//! migration from the T6b deploy.

#[allow(dead_code)] // each test binary uses a subset of the shared helpers
mod common;

use common::batches::{ONES, commit, matchup};
use common::wallet::{
    link, linked_player, new_wallet, owner_withdraw, storage_usage, wallet_link, wallet_withdraw,
    with_yocto, withdraw_args,
};
use common::{Env, R, assert_fails, done, event, events_named, ok, record_gas, tgas};
use near_api::{AccountId, Contract};
use near_sdk::serde_json::{Value, json};

/// The wasm deployed to game.hyperdrome.testnet by T6b (code hash
/// `2ctpTSVNWEnpRFYuxcNjGSMhKL1YhwhsJ9TQrCmHL93D`), read back from testnet with `view_code`. Its
/// contract state is `VersionedState::V1`.
const T6B_WASM: &[u8] = include_bytes!("fixtures/hyperdrome-t6b.wasm");
const T6B_WASM_SHA256: &str = "180d9b34cd3d6f2f63c1423f86661a1265bdb9c9240641bcf9209bf011078d58";

#[tokio::test]
async fn link_wallet_rules() -> R<()> {
    let env = Env::start().await?;
    let p = env.funded_player("pilot", false, 0).await?;
    let wallet = env.stranger.clone();
    let args = json!({ "player": p.id, "wallet": wallet });

    assert_fails(
        env.call(&env.stranger, "link_wallet", args.clone()).await,
        "not owner",
    );
    let unknown: AccountId = "nobody.sandbox".parse()?;
    assert_fails(link(&env, &unknown, &wallet).await, "not found");
    let team = env.funded_player("vortex", true, 0).await?;
    assert_fails(link(&env, &team.id, &wallet).await, "team");

    let under_game: AccountId = format!("a.b.{}", env.game).parse()?;
    for bad in [&env.game, &env.owner, &under_game, &p.id] {
        assert_fails(link(&env, &p.id, bad).await, "bad wallet");
    }

    assert_eq!(wallet_link(&env, &p.id).await?, Value::Null);
    let registered: Value = env
        .view("storage_balance_of", json!({ "account_id": wallet }))
        .await?;
    assert_eq!(registered, Value::Null, "the wallet starts unregistered");

    let before = storage_usage(&env).await?;
    let out = ok(link(&env, &p.id, &wallet).await)?;
    let after = storage_usage(&env).await?;
    println!("STORAGE link_wallet {} bytes", after - before);
    record_gas(&out, "link_wallet");
    assert_eq!(
        event(&out, "hyperdrome", "wallet_linked")["data"],
        json!({ "player": p.id, "wallet": wallet })
    );
    assert_eq!(wallet_link(&env, &p.id).await?, json!(wallet));
    let registered: Value = env
        .view("storage_balance_of", json!({ "account_id": wallet }))
        .await?;
    assert_ne!(registered, Value::Null, "link_wallet registered the wallet");

    let other = new_wallet(&env, "other").await?;
    assert_fails(link(&env, &p.id, &other).await, "linked");
    assert_fails(link(&env, &p.id, &wallet).await, "linked");
    assert_eq!(wallet_link(&env, &p.id).await?, json!(wallet));
    Ok(())
}

#[tokio::test]
async fn only_the_wallet_unlinks() -> R<()> {
    let env = Env::start().await?;
    let p = env.funded_player("pilot", false, 0).await?;
    let wallet = env.stranger.clone();
    let args = json!({ "player": p.id });

    assert_fails(
        with_yocto(&env, &wallet, "unlink_wallet", args.clone()).await,
        "not linked",
    );
    done(link(&env, &p.id, &wallet).await);

    assert_fails(
        env.call(&wallet, "unlink_wallet", args.clone()).await,
        "Requires attached deposit of exactly 1 yoctoNEAR",
    );
    for caller in [&env.owner, &env.game] {
        assert_fails(
            with_yocto(&env, caller, "unlink_wallet", args.clone()).await,
            "not owner",
        );
    }
    assert_eq!(wallet_link(&env, &p.id).await?, json!(wallet));

    let out = ok(with_yocto(&env, &wallet, "unlink_wallet", args.clone()).await)?;
    record_gas(&out, "unlink_wallet");
    assert_eq!(
        event(&out, "hyperdrome", "wallet_unlinked")["data"],
        json!({ "player": p.id, "wallet": wallet })
    );
    assert_eq!(wallet_link(&env, &p.id).await?, Value::Null);
    assert_fails(owner_withdraw(&env, &p.id, &[], 1).await, "not linked");

    // Once unlinked a new link is allowed.
    let other = new_wallet(&env, "other").await?;
    done(link(&env, &p.id, &other).await);
    assert_eq!(wallet_link(&env, &p.id).await?, json!(other));
    Ok(())
}

#[tokio::test]
async fn owner_and_wallet_paths_move_a_drone_with_its_bound_items() -> R<()> {
    let env = Env::start().await?;
    let (mut p, wallet) = linked_player(&env, "pilot", 100).await?;
    let drone = env.mint_drone(&p.id, ONES).await?;
    let skin = env.mint_item(&p.id, "skin", 4, None).await?;
    let modd = env.mint_item(&p.id, "mod", 1, None).await?;
    done(
        env.play(&mut p, "bind", json!({ "drone": drone, "item": skin }))
            .await,
    );
    done(
        env.play(&mut p, "bind", json!({ "drone": drone, "item": modd }))
            .await,
    );

    // The owner path, no deposit.
    let out = ok(owner_withdraw(&env, &p.id, &[&drone], 30).await)?;
    record_gas(&out, "withdraw (1 drone + 2 bound + volts)");
    for token in [&drone, &skin, &modd] {
        assert_eq!(env.owner_of(token).await?, wallet.as_str());
    }
    assert_eq!(env.volts(&p.id).await?, 70);
    assert_eq!(env.volts(&wallet).await?, 30);
    let moved = event(&out, "nep171", "nft_transfer")["data"][0].clone();
    assert_eq!(moved["old_owner_id"], p.id.as_str());
    assert_eq!(moved["new_owner_id"], wallet.as_str());
    assert_eq!(moved["token_ids"], json!([drone, skin, modd]));
    assert_eq!(moved["authorized_id"], env.owner.as_str());
    let ft = event(&out, "nep141", "ft_transfer")["data"][0].clone();
    assert_eq!(ft["old_owner_id"], p.id.as_str());
    assert_eq!(ft["new_owner_id"], wallet.as_str());
    assert_eq!(ft["amount"], "30");
    assert_eq!(
        event(&out, "hyperdrome", "withdrawn")["data"],
        json!({ "player": p.id, "wallet": wallet, "tokens": [drone], "volts": "30" })
    );

    // The drone's record is intact in the wallet.
    let view: Value = env.view("get_drone", json!({ "token": drone })).await?;
    assert_eq!(view["owner"], wallet.as_str());
    assert_eq!(view["cold"]["bound_skins"], json!([skin]));
    assert_eq!(view["cold"]["bound_mods"], json!([modd]));
    assert_eq!(view["hot"]["equipped_mod"], json!(modd));

    // The wallet path, 1 yocto; an unbound item and Volts.
    let spare = env.mint_item(&p.id, "mod", 2, None).await?;
    assert_fails(
        env.call(&wallet, "withdraw", withdraw_args(&p.id, &[&spare], 0))
            .await,
        "Requires attached deposit of exactly 1 yoctoNEAR",
    );
    let out = ok(wallet_withdraw(&env, &wallet, &p.id, &[&spare], 5).await)?;
    record_gas(&out, "withdraw from the wallet (1 item + volts)");
    assert_eq!(env.owner_of(&spare).await?, wallet.as_str());
    assert_eq!(env.volts(&p.id).await?, 65);
    assert_eq!(env.volts(&wallet).await?, 35);
    let moved = event(&out, "nep171", "nft_transfer")["data"][0].clone();
    assert_eq!(moved["authorized_id"], wallet.as_str());
    Ok(())
}

#[tokio::test]
async fn withdraw_refusals_revert_the_whole_call() -> R<()> {
    let env = Env::start().await?;
    let (mut p, wallet) = linked_player(&env, "pilot", 100).await?;
    let drone = env.mint_drone(&p.id, ONES).await?;
    let racer = env.mint_drone(&p.id, ONES).await?;
    let foe = env.mint_drone(&p.id, ONES).await?;
    let skin = env.mint_item(&p.id, "skin", 4, None).await?;
    let spare = env.mint_item(&p.id, "mod", 1, None).await?;
    let for_sale = env.mint_item(&p.id, "mod", 2, None).await?;
    done(
        env.play(&mut p, "bind", json!({ "drone": drone, "item": skin }))
            .await,
    );
    done(
        env.play(&mut p, "list", json!({ "token": for_sale, "price": "10" }))
            .await,
    );
    done(commit(&env, 1, &[matchup(&racer, &foe, 0)]).await);

    // Callers.
    let stranger = new_wallet(&env, "other").await?;
    assert_fails(
        wallet_withdraw(&env, &stranger, &p.id, &[&spare], 0).await,
        "not owner",
    );
    assert_fails(
        with_yocto(
            &env,
            &env.owner,
            "withdraw",
            withdraw_args(&p.id, &[&spare], 0),
        )
        .await,
        "bad deposit",
    );
    let unlinked = env.funded_player("alone", false, 0).await?;
    assert_fails(
        owner_withdraw(&env, &unlinked.id, &[], 1).await,
        "not linked",
    );

    // Per token, each after a token that would have moved: nothing moves, Volts stay.
    let other = env.funded_player("rival", false, 0).await?;
    let foreign = env.mint_item(&other.id, "mod", 3, None).await?;
    for (bad, needle) in [
        ("m:999", "not found"),
        (foreign.as_str(), "not owner"),
        (skin.as_str(), "bound item"),
        (for_sale.as_str(), "listed"),
        (racer.as_str(), "locked"),
    ] {
        assert_fails(owner_withdraw(&env, &p.id, &[&spare, bad], 1).await, needle);
        assert_eq!(
            env.owner_of(&spare).await?,
            p.id.as_str(),
            "{needle} reverted"
        );
        assert_eq!(env.volts(&p.id).await?, 100, "{needle} reverted Volts");
    }

    // A token named twice cannot move twice.
    assert_fails(
        owner_withdraw(&env, &p.id, &[&spare, &spare], 0).await,
        "not owner",
    );
    assert_fails(
        owner_withdraw(&env, &p.id, &[], 101).await,
        "insufficient volts",
    );
    assert_fails(
        owner_withdraw(&env, &p.id, &[], 0).await,
        "nothing to withdraw",
    );

    // A wallet that removed its Volts registration can take tokens, not Volts.
    done(with_yocto(&env, &wallet, "storage_unregister", json!({})).await);
    assert_fails(owner_withdraw(&env, &p.id, &[], 1).await, "not registered");
    done(owner_withdraw(&env, &p.id, &[&spare], 0).await);
    assert_eq!(env.owner_of(&spare).await?, wallet.as_str());
    Ok(())
}

#[tokio::test]
async fn max_tokens_fit_the_gas_and_log_budgets() -> R<()> {
    let env = Env::start().await?;
    // A 64-character wallet: the longest NEAR account id.
    let long_name = "w".repeat(64 - ".sandbox".len());
    let wallet = new_wallet(&env, &long_name).await?;
    let p = env
        .funded_player("aaaaaaaaaaaaaaaaaaaa", false, 100)
        .await?;
    done(link(&env, &p.id, &wallet).await);

    let constants: Value = env.view("get_constants", json!({})).await?;
    let max = constants["economy"]["max_withdraw_tokens"]
        .as_u64()
        .expect("get_constants has the limit") as usize;

    let mut tokens = Vec::with_capacity(max + 1);
    for _ in 0..=max {
        tokens.push(env.mint_item(&p.id, "mod", 1, None).await?);
    }
    let refs: Vec<&str> = tokens.iter().map(String::as_str).collect();
    assert_fails(
        owner_withdraw(&env, &p.id, &refs, 1).await,
        "too many tokens",
    );

    let out = ok(owner_withdraw(&env, &p.id, &refs[..max], 1).await)?;
    record_gas(&out, "withdraw (max tokens, each its own transfer, volts)");
    let bytes: usize = out.logs().iter().map(|l| l.len()).sum();
    // The sandbox ids are shorter than testnet's: `m:<n>` here against 7 characters there, on the
    // nep171 event and the `withdrawn` list, and a 46-character player id against this one's.
    let id_width: usize = refs[..max].iter().map(|t| 7 - t.len()).sum();
    let player_width = max * (46 - p.id.as_str().len());
    let projected = bytes + 2 * id_width + player_width;
    println!("LOGS withdraw max tokens: {bytes} bytes, {projected} at testnet id widths");
    assert!(tgas(&out) <= 150.0, "gas {} over the budget", tgas(&out));
    assert!(projected <= 14_000, "logs {projected} over the budget");
    assert_eq!(events_named(&out, "nep171", "nft_transfer").len(), max);
    Ok(())
}

#[tokio::test]
async fn migrates_from_the_deployed_t6b_code() -> R<()> {
    let digest = near_sdk::env::sha256_array(T6B_WASM);
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(hex, T6B_WASM_SHA256, "the fixture is the T6b deploy");

    let env = Env::start_with(T6B_WASM.to_vec()).await?;
    let mut p = env.funded_player("pilot", false, 40).await?;
    let drone = env.mint_drone(&p.id, ONES).await?;
    let skin = env.mint_item(&p.id, "skin", 4, None).await?;
    done(
        env.play(&mut p, "bind", json!({ "drone": drone, "item": skin }))
            .await,
    );

    Contract::deploy(env.game.clone())
        .use_code(common::wasm())
        .with_init_call("migrate", json!({}))?
        .with_signer(env.signer.clone())
        .send_to(&env.net)
        .await?
        .assert_success();

    // Every old record is readable through the new layout.
    let player: Value = env.view("get_player", json!({ "account": p.id })).await?;
    assert_eq!(player["seq"], 1);
    assert_eq!(env.volts(&p.id).await?, 40);
    assert_eq!(env.owner_of(&drone).await?, p.id.as_str());
    assert_eq!(wallet_link(&env, &p.id).await?, Value::Null);

    // Migrating again keeps the new state.
    let wallet = env.stranger.clone();
    done(link(&env, &p.id, &wallet).await);
    Contract::deploy(env.game.clone())
        .use_code(common::wasm())
        .with_init_call("migrate", json!({}))?
        .with_signer(env.signer.clone())
        .send_to(&env.net)
        .await?
        .assert_success();
    assert_eq!(wallet_link(&env, &p.id).await?, json!(wallet));

    let out = ok(owner_withdraw(&env, &p.id, &[&drone], 10).await)?;
    assert_eq!(
        event(&out, "nep171", "nft_transfer")["data"][0]["token_ids"],
        json!([drone, skin])
    );
    assert_eq!(env.owner_of(&skin).await?, wallet.as_str());
    assert_eq!(env.volts(&wallet).await?, 10);
    Ok(())
}
