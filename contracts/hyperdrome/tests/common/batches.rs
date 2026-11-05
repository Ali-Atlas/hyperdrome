//! Batch helpers shared by the settlement test binaries: seeds, matchups, results carrying the
//! drones' current stats hashes, commit and settle calls, and drone records.

use near_api::types::transaction::result::ExecutionFinalResult;
use near_sdk::serde_json::{Value, json};

use super::{Env, R, done};

/// The seed every helper commits and settles with.
pub const SEED: [u8; 32] = [42; 32];
/// Stats of a minimal level-1 drone.
pub const ONES: [u8; 9] = [1; 9];
pub type Outcome = Result<ExecutionFinalResult, String>;

pub fn seed_hash(seed: [u8; 32]) -> [u8; 32] {
    near_sdk::env::sha256_array(seed)
}

pub fn matchup(a: &str, b: &str, track: u8) -> Value {
    json!({ "a": a, "b": b, "track": track, "weather": 2, "tod": 3 })
}

pub async fn drone(env: &Env, token: &str) -> R<Value> {
    env.view("get_drone", json!({ "token": token })).await
}

pub async fn stats_hash(env: &Env, token: &str) -> R<[u8; 32]> {
    env.view("stats_hash", json!({ "token": token })).await
}

/// A result for `a` vs `b` carrying both drones' current stats hashes.
pub async fn result(env: &Env, a: &str, b: &str, winner: &str, ta: u32, tb: u32) -> R<Value> {
    Ok(json!({
        "a": a, "b": b, "winner": winner, "time_a_ms": ta, "time_b_ms": tb,
        "stats_hash_a": stats_hash(env, a).await?, "stats_hash_b": stats_hash(env, b).await?,
    }))
}

pub fn commit_args(batch_id: u64, matchups: &[Value]) -> Value {
    json!({ "batch_id": batch_id, "seed_hash": seed_hash(SEED), "matchups": matchups })
}

pub fn settle_args(batch_id: u64, seed: [u8; 32], from: u32, results: &[Value]) -> Value {
    json!({ "batch_id": batch_id, "seed": seed, "from": from, "results": results })
}

pub async fn commit(env: &Env, batch_id: u64, matchups: &[Value]) -> Outcome {
    let args = commit_args(batch_id, matchups);
    env.call(&env.game, "commit_batch", args).await
}

pub async fn settle(env: &Env, batch_id: u64, from: u32, results: &[Value]) -> Outcome {
    let args = settle_args(batch_id, SEED, from, results);
    env.call(&env.game, "settle_batch", args).await
}

/// `(elo, xp, level, wins, losses)` and `in_batch` of a drone.
pub async fn record(env: &Env, token: &str) -> R<((i64, u64, u64, u64, u64), Value)> {
    let h = drone(env, token).await?["hot"].clone();
    let n = |k: &str| h[k].as_u64().unwrap_or(u64::MAX);
    let elo = h["elo"].as_i64().unwrap_or(i64::MIN);
    Ok((
        (elo, n("xp"), n("level"), n("wins"), n("losses")),
        h["in_batch"].clone(),
    ))
}

/// `count` one-race batches from `first_id` in which `winner` beats `loser`, committed and settled
/// in the same transaction, five batches per transaction.
pub async fn win_races(env: &Env, winner: &str, loser: &str, first_id: u64, count: u64) -> R<()> {
    let r = result(env, winner, loser, winner, 60_000, 61_000).await?;
    let m = matchup(winner, loser, 0);
    let ids: Vec<u64> = (first_id..first_id + count).collect();
    for group in ids.chunks(5) {
        let mut calls = Vec::new();
        for &id in group {
            let settle = settle_args(id, SEED, 0, std::slice::from_ref(&r));
            calls.push(("commit_batch", commit_args(id, std::slice::from_ref(&m))));
            calls.push(("settle_batch", settle));
        }
        done(
            env.multi_call_as(&env.game, env.signer.clone(), calls, 25)
                .await,
        );
    }
    Ok(())
}

/// Mints `count` level-1 drones to the contract (bots) in one transaction; ids follow `first`.
pub async fn mint_bots(env: &Env, first: u64, count: u64) -> R<Vec<String>> {
    let args =
        json!({ "owner": env.game, "name": "B", "level": 1, "stats": ONES, "active_hint": true });
    let calls = (0..count).map(|_| ("mint_drone", args.clone())).collect();
    done(
        env.multi_call_as(&env.owner, env.signer.clone(), calls, 15)
            .await,
    );
    Ok((first..first + count).map(|n| format!("d:{n}")).collect())
}

pub fn race(
    i: u32,
    (a, b, winner): (&str, &str, &str),
    (ta, tb): (u32, u32),
    (va, vb): (u128, u128),
    (elo_a, elo_b): (i32, i32),
    (xp_a, xp_b): (u32, u32),
    (lvl_a, lvl_b): (u8, u8),
) -> Value {
    json!({
        "i": i, "a": a, "b": b, "winner": winner, "ta": ta, "tb": tb,
        "va": va.to_string(), "vb": vb.to_string(), "elo_a": elo_a, "elo_b": elo_b,
        "xp_a": xp_a, "xp_b": xp_b, "lvl_a": lvl_a, "lvl_b": lvl_b,
    })
}
