//! Wallet helpers for tests/wallet.rs: calls with 1 yocto, wallet accounts, link and withdraw calls.

use near_api::{AccountId, NearToken};
use near_sdk::serde_json::{Value, json};

use super::batches::Outcome;
use super::{Env, OWNER_GAS_TGAS, R, TestPlayer, done};

/// Calls `method` as the sandbox-key account `caller`, with 1 yocto (the wallet's path).
pub async fn with_yocto(env: &Env, caller: &AccountId, method: &str, args: Value) -> Outcome {
    env.call_with(
        caller,
        env.signer.clone(),
        method,
        args,
        NearToken::from_yoctonear(1),
        OWNER_GAS_TGAS,
    )
    .await
}

pub async fn new_wallet(env: &Env, name: &str) -> R<AccountId> {
    let id: AccountId = format!("{name}.sandbox").parse()?;
    env._sandbox
        .create_account(id.as_str().parse()?)
        .initial_balance(NearToken::from_near(5))
        .send()
        .await?;
    Ok(id)
}

pub async fn link(env: &Env, player: &AccountId, wallet: &AccountId) -> Outcome {
    let args = json!({ "player": player, "wallet": wallet });
    env.call(&env.owner, "link_wallet", args).await
}

pub async fn wallet_link(env: &Env, player: &AccountId) -> R<Value> {
    env.view("get_wallet_link", json!({ "player": player }))
        .await
}

pub fn withdraw_args(player: &AccountId, tokens: &[&str], volts: u128) -> Value {
    json!({ "player": player, "tokens": tokens, "volts": volts.to_string() })
}

pub async fn owner_withdraw(
    env: &Env,
    player: &AccountId,
    tokens: &[&str],
    volts: u128,
) -> Outcome {
    let args = withdraw_args(player, tokens, volts);
    env.call(&env.owner, "withdraw", args).await
}

pub async fn wallet_withdraw(
    env: &Env,
    wallet: &AccountId,
    player: &AccountId,
    tokens: &[&str],
    volts: u128,
) -> Outcome {
    let args = withdraw_args(player, tokens, volts);
    with_yocto(env, wallet, "withdraw", args).await
}

/// A funded player with a linked wallet (`stranger.sandbox`).
pub async fn linked_player(env: &Env, slug: &str, volts: u128) -> R<(TestPlayer, AccountId)> {
    let p = env.funded_player(slug, false, volts).await?;
    let wallet = env.stranger.clone();
    done(link(env, &p.id, &wallet).await);
    Ok((p, wallet))
}

pub async fn storage_usage(env: &Env) -> R<u64> {
    Ok(near_api::Account(env.game.clone())
        .view()
        .fetch_from(&env.net)
        .await?
        .data
        .storage_usage)
}
