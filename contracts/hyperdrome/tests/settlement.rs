//! Sandbox tests for settlement (SPEC.md 4.4): commit and chunked settle, payouts to owners,
//! escrow sellers and nobody for bots, ELO, XP and level-ups, the exact events, every failure path
//! by its panic string, the lock rule on player methods, and the chunk-size gas and log budget
//! (SPEC.md 13).

#[allow(dead_code)] // each test binary uses a subset of the shared helpers
mod common;

use common::{Env, R, assert_fails, done, event, ok, record_gas, tgas};
use near_api::NearToken;
use near_api::types::transaction::result::ExecutionFinalResult;
use near_sdk::serde_json::{Value, json};

const SEED: [u8; 32] = [42; 32];
const ONES: [u8; 9] = [1; 9];
/// SPEC.md 13: one chunk of `CHUNK` races burns at most 150 TGas and logs at most 14,000 bytes.
/// 50 races logged 15,779 bytes in the worst case below, so the chunk is 40.
const CHUNK: usize = 40;
const CHUNK_TGAS_BUDGET: f64 = 150.0;
const CHUNK_LOG_BYTES_BUDGET: usize = 14_000;
/// Token ids are counted at this length in the log budget ("d:99999").
const TOKEN_ID_LEN: usize = 7;

type Outcome = Result<ExecutionFinalResult, String>;

fn seed_hash(seed: [u8; 32]) -> [u8; 32] {
    near_sdk::env::sha256_array(seed)
}

fn matchup(a: &str, b: &str, track: u8) -> Value {
    json!({ "a": a, "b": b, "track": track, "weather": 2, "tod": 3 })
}

async fn drone(env: &Env, token: &str) -> R<Value> {
    env.view("get_drone", json!({ "token": token })).await
}

async fn stats_hash(env: &Env, token: &str) -> R<[u8; 32]> {
    env.view("stats_hash", json!({ "token": token })).await
}

/// A result for `a` vs `b` carrying both drones' current stats hashes.
async fn result(env: &Env, a: &str, b: &str, winner: &str, ta: u32, tb: u32) -> R<Value> {
    Ok(json!({
        "a": a, "b": b, "winner": winner, "time_a_ms": ta, "time_b_ms": tb,
        "stats_hash_a": stats_hash(env, a).await?, "stats_hash_b": stats_hash(env, b).await?,
    }))
}

fn commit_args(batch_id: u64, matchups: &[Value]) -> Value {
    json!({ "batch_id": batch_id, "seed_hash": seed_hash(SEED), "matchups": matchups })
}

fn settle_args(batch_id: u64, seed: [u8; 32], from: u32, results: &[Value]) -> Value {
    json!({ "batch_id": batch_id, "seed": seed, "from": from, "results": results })
}

async fn commit(env: &Env, batch_id: u64, matchups: &[Value]) -> Outcome {
    let args = commit_args(batch_id, matchups);
    env.call(&env.game, "commit_batch", args).await
}

async fn settle(env: &Env, batch_id: u64, from: u32, results: &[Value]) -> Outcome {
    let args = settle_args(batch_id, SEED, from, results);
    env.call(&env.game, "settle_batch", args).await
}

/// `(elo, xp, level, wins, losses)` and `in_batch` of a drone.
async fn record(env: &Env, token: &str) -> R<((i64, u64, u64, u64, u64), Value)> {
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
async fn win_races(env: &Env, winner: &str, loser: &str, first_id: u64, count: u64) -> R<()> {
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
async fn mint_bots(env: &Env, first: u64, count: u64) -> R<Vec<String>> {
    let args =
        json!({ "owner": env.game, "name": "B", "level": 1, "stats": ONES, "active_hint": true });
    let calls = (0..count).map(|_| ("mint_drone", args.clone())).collect();
    done(
        env.multi_call_as(&env.owner, env.signer.clone(), calls, 15)
            .await,
    );
    Ok((first..first + count).map(|n| format!("d:{n}")).collect())
}

fn race(
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

#[tokio::test]
async fn four_race_batch_pays_owners_sellers_and_level_ups() -> R<()> {
    let env = Env::start().await?;
    let one = env.funded_player("one", false, 0).await?;
    let mut two = env.funded_player("two", false, 0).await?;
    let three = env.funded_player("three", false, 0).await?;
    let d1 = env.mint_drone(&one.id, ONES).await?;
    let dx = env.mint_drone(&one.id, ONES).await?;
    let de = env.mint_drone(&two.id, ONES).await?;
    let dq = env.mint_drone_at(&two.id, 2, ONES).await?;
    let dc = env.mint_drone(&three.id, ONES).await?;
    let dp = env.mint_drone_at(&three.id, 4, ONES).await?;
    let bots = mint_bots(&env, 7, 3).await?;
    let (bot1, bot2, bot3) = (&bots[0], &bots[1], &bots[2]);
    done(
        env.play(&mut two, "list", json!({ "token": de, "price": "100" }))
            .await,
    );

    // 19 wins against bot3 (3 Volts each: track 0, no gap, no dominance) leave dx at 190 XP.
    win_races(&env, &dx, bot3, 1, 19).await?;
    let (dx_before, _) = record(&env, &dx).await?;
    assert_eq!((dx_before.1, dx_before.2, dx_before.3), (190, 1, 19));
    assert_eq!(env.volts(&one.id).await?, 19 * 3);
    let dx_elo = i32::try_from(dx_before.0)?;

    let matchups = [
        matchup(&d1, bot1, 3),
        matchup(&de, &dc, 0),
        matchup(bot2, &dx, 15),
        matchup(&dp, &dq, 1),
    ];
    let out = ok(commit(&env, 100, &matchups).await)?;
    record_gas(&out, "commit_batch (4 races)");
    assert_eq!(
        event(&out, "hyperdrome", "batch_committed")["data"],
        json!({ "batch_id": 100, "count": 4 })
    );
    assert_eq!(record(&env, &de).await?.1, json!(100), "listed drones race");

    let results = [
        result(&env, &d1, bot1, &d1, 100_000, 150_000).await?,
        result(&env, &de, &dc, &de, 100_000, 125_000).await?,
        result(&env, bot2, &dx, &dx, 140_000, 100_000).await?,
        result(&env, &dp, &dq, &dq, 120_000, 100_000).await?,
    ];
    let out = ok(settle(&env, 100, 0, &results).await)?;
    record_gas(&out, "settle_batch (4 races)");
    assert_eq!(out.logs().len(), 2, "one ft_mint and one batch_settled");

    // Payouts (SPEC.md 2.3), Volts to the owner, the escrow seller, nobody for bots:
    // race 0: L1 winner, difficulty 3, 50% margin: 3 + 0 + 1 + 0 + 5 = 9; the bot gets nothing.
    // race 1: difficulty 1, 25% margin: 3 + 2 = 5 to seller `two`; L1 loser 1 to `three`.
    // race 2: difficulty 10, exactly 40% margin: 3 + 5 + 2 = 10, plus 20 for reaching L2.
    // race 3: L2 winner, difficulty 2, exactly 20% margin: 3 + 1 + 1 = 5; L4 loser 1 + 1 = 2.
    assert_eq!(
        event(&out, "nep141", "ft_mint")["data"],
        json!([
            { "owner_id": one.id, "amount": "39" },
            { "owner_id": two.id, "amount": "10" },
            { "owner_id": three.id, "amount": "3" },
        ])
    );
    let (gain, loss) = hyperdrome::math::elo_deltas(dx_elo, 1_000);
    let even = (1_016, 984);
    let races = [
        race(
            0,
            (&d1, bot1, &d1),
            (100_000, 150_000),
            (9, 0),
            even,
            (10, 4),
            (1, 1),
        ),
        race(
            1,
            (&de, &dc, &de),
            (100_000, 125_000),
            (5, 1),
            even,
            (10, 4),
            (1, 1),
        ),
        race(
            2,
            (bot2, &dx, &dx),
            (140_000, 100_000),
            (0, 30),
            (1_000 + loss, dx_elo + gain),
            (4, 0),
            (1, 2),
        ),
        race(
            3,
            (&dp, &dq, &dq),
            (120_000, 100_000),
            (2, 5),
            (984, 1_016),
            (4, 10),
            (4, 2),
        ),
    ];
    assert_eq!(
        event(&out, "hyperdrome", "batch_settled")["data"],
        json!({ "batch_id": 100, "races": races })
    );

    assert_eq!(env.volts(&one.id).await?, 19 * 3 + 39);
    assert_eq!(env.volts(&two.id).await?, 10);
    assert_eq!(env.volts(&three.id).await?, 3);
    let expected = [
        (&d1, (1_016, 10, 1, 1, 0)),
        (bot1, (984, 4, 1, 0, 1)),
        (&de, (1_016, 10, 1, 1, 0)),
        (&dc, (984, 4, 1, 0, 1)),
        (bot2, (i64::from(1_000 + loss), 4, 1, 0, 1)),
        (&dx, (i64::from(dx_elo + gain), 0, 2, 20, 0)),
        (&dp, (984, 4, 4, 0, 1)),
        (&dq, (1_016, 10, 2, 1, 0)),
    ];
    for (token, want) in expected {
        let (got, in_batch) = record(&env, token).await?;
        assert_eq!(got, want, "{token}: (elo, xp, level, wins, losses)");
        assert_eq!(in_batch, Value::Null, "{token} left the batch");
    }
    assert_eq!(
        env.owner_of(&de).await?,
        env.game.to_string(),
        "still escrowed"
    );
    let batch: Value = env.view("get_batch", json!({ "id": 100 })).await?;
    assert_eq!(
        (&batch["settled"], &batch["settled_count"]),
        (&json!(true), &json!(4))
    );
    Ok(())
}

#[tokio::test]
async fn settlement_failure_paths() -> R<()> {
    let env = Env::start().await?;
    let mut p = env.funded_player("pilot", false, 100).await?;
    let mut ids = Vec::new();
    for _ in 0..4 {
        ids.push(env.mint_drone(&p.id, ONES).await?);
    }
    let (a, b, c, d) = (&ids[0], &ids[1], &ids[2], &ids[3]);

    for caller in [&env.stranger, &env.owner] {
        let commit = commit_args(1, &[matchup(a, b, 0)]);
        assert_fails(
            env.call(caller, "commit_batch", commit).await,
            "Method commit_batch is private",
        );
        let settle = settle_args(1, SEED, 0, &[]);
        assert_fails(
            env.call(caller, "settle_batch", settle).await,
            "Method settle_batch is private",
        );
    }
    assert_fails(commit(&env, 1, &[matchup(a, "d:99", 0)]).await, "not found");
    assert_fails(commit(&env, 1, &[matchup(a, b, 16)]).await, "not found");
    assert_fails(settle(&env, 1, 0, &[]).await, "not found");

    done(commit(&env, 1, &[matchup(a, b, 0)]).await);
    assert_fails(commit(&env, 1, &[matchup(c, d, 0)]).await, "exists");
    assert_fails(commit(&env, 2, &[matchup(a, c, 0)]).await, "locked");
    let twice = [matchup(c, d, 0), matchup(d, c, 0)];
    assert_fails(commit(&env, 2, &twice).await, "locked");
    assert_fails(commit(&env, 2, &[matchup(c, c, 0)]).await, "locked");

    // Inside the strategy window the owner may still allocate; a result computed before that
    // carries the old hash.
    let stale = result(&env, a, b, a, 60_000, 61_000).await?;
    let mut stats = ONES;
    stats[0] = 2;
    done(
        env.play(
            &mut p,
            "allocate_stats",
            json!({ "drone": a, "stats": stats }),
        )
        .await,
    );
    let fresh = result(&env, a, b, a, 60_000, 61_000).await?;

    let bad_seed = settle_args(1, [9; 32], 0, std::slice::from_ref(&fresh));
    assert_fails(
        env.call(&env.game, "settle_batch", bad_seed).await,
        "bad seed",
    );
    assert_fails(
        settle(&env, 1, 1, std::slice::from_ref(&fresh)).await,
        "bad chunk",
    );
    let swapped = result(&env, b, a, a, 60_000, 61_000).await?;
    assert_fails(settle(&env, 1, 0, &[swapped]).await, "bad chunk");
    let outsider = result(&env, a, b, c, 60_000, 61_000).await?;
    assert_fails(settle(&env, 1, 0, &[outsider]).await, "bad chunk");
    let zero = result(&env, a, b, a, 0, 61_000).await?;
    assert_fails(settle(&env, 1, 0, &[zero]).await, "bad chunk");
    let overrun = [fresh.clone(), fresh.clone()];
    assert_fails(settle(&env, 1, 0, &overrun).await, "bad chunk");
    assert_fails(settle(&env, 1, 0, &[stale]).await, "state drift");

    done(settle(&env, 1, 0, std::slice::from_ref(&fresh)).await);
    assert_fails(
        settle(&env, 1, 0, std::slice::from_ref(&fresh)).await,
        "settled",
    );
    assert_fails(settle(&env, 1, 1, &[]).await, "settled");
    done(commit(&env, 2, &[matchup(a, c, 0)]).await);
    Ok(())
}

#[tokio::test]
async fn six_races_settle_in_two_chunks_of_three() -> R<()> {
    let env = Env::start().await?;
    let p = env.funded_player("pilot", false, 0).await?;
    let args =
        json!({ "owner": p.id, "name": "T", "level": 1, "stats": ONES, "active_hint": true });
    let calls = (0..12).map(|_| ("mint_drone", args.clone())).collect();
    done(
        env.multi_call_as(&env.owner, env.signer.clone(), calls, 15)
            .await,
    );
    let ids: Vec<String> = (1..=12).map(|n| format!("d:{n}")).collect();
    let pairs: Vec<(&str, &str)> = ids
        .chunks(2)
        .map(|c| (c[0].as_str(), c[1].as_str()))
        .collect();
    let matchups: Vec<Value> = pairs.iter().map(|(a, b)| matchup(a, b, 1)).collect();
    done(commit(&env, 7, &matchups).await);
    let mut results = Vec::new();
    for (a, b) in &pairs {
        results.push(result(&env, a, b, a, 70_000, 72_000).await?);
    }

    let out = ok(settle(&env, 7, 0, &results[..3]).await)?;
    let first: Vec<Value> = event(&out, "hyperdrome", "batch_settled")["data"]["races"]
        .as_array()
        .map(|r| r.iter().map(|x| x["i"].clone()).collect())
        .unwrap_or_default();
    assert_eq!(first, [json!(0), json!(1), json!(2)]);
    let batch: Value = env.view("get_batch", json!({ "id": 7 })).await?;
    assert_eq!(
        (&batch["settled"], &batch["settled_count"]),
        (&json!(false), &json!(3))
    );
    for (k, token) in ids.iter().enumerate() {
        let in_batch = if k < 6 { Value::Null } else { json!(7) };
        assert_eq!(record(&env, token).await?.1, in_batch, "{token}");
    }
    assert_fails(settle(&env, 7, 0, &results[..3]).await, "settled");

    let out = ok(settle(&env, 7, 3, &results[3..]).await)?;
    assert_eq!(
        event(&out, "hyperdrome", "batch_settled")["data"]["races"][0]["i"],
        3
    );
    let batch: Value = env.view("get_batch", json!({ "id": 7 })).await?;
    assert_eq!(
        (&batch["settled"], &batch["settled_count"]),
        (&json!(true), &json!(6))
    );
    for token in &ids {
        assert_eq!(record(&env, token).await?.1, Value::Null, "{token}");
    }
    Ok(())
}

#[tokio::test]
async fn locked_drones_refuse_player_moves_until_settled() -> R<()> {
    let env = Env::start().await?;
    let mut p = env.funded_player("pilot", false, 100).await?;
    let d = env.mint_drone(&p.id, ONES).await?;
    let m = env.mint_item(&p.id, "mod", 1, None).await?;
    done(
        env.play(&mut p, "bind", json!({ "drone": d, "item": m }))
            .await,
    );
    let bot = mint_bots(&env, 2, 1).await?.remove(0);
    done(commit(&env, 1, &[matchup(&d, &bot, 0)]).await);
    assert_eq!(drone(&env, &d).await?["locked"], false, "strategy window");
    let r = result(&env, &d, &bot, &bot, 61_000, 60_000).await?;

    for _ in 0..20 {
        if drone(&env, &d).await?["locked"] == true {
            break;
        }
        env._sandbox.fast_forward(500).await?;
    }
    assert_eq!(drone(&env, &d).await?["locked"], true, "120 s after commit");

    let mut stats = ONES;
    stats[1] = 2;
    let allocate = json!({ "drone": d, "stats": stats });
    let unequip = json!({ "drone": d, "item": null, "kind": "mod" });
    let transfer = json!({ "receiver_id": env.stranger, "token_id": d });
    let one_yocto = NearToken::from_yoctonear(1);
    assert_fails(
        env.play(&mut p, "allocate_stats", allocate.clone()).await,
        "locked",
    );
    assert_fails(env.play(&mut p, "equip", unequip.clone()).await, "locked");
    let sent = env
        .call_with(
            &p.id,
            p.admin.clone(),
            "nft_transfer",
            transfer.clone(),
            one_yocto,
            30,
        )
        .await;
    assert_fails(sent, "locked");

    done(settle(&env, 1, 0, &[r]).await);
    assert_eq!(drone(&env, &d).await?["locked"], false);
    done(env.play(&mut p, "allocate_stats", allocate).await);
    done(env.play(&mut p, "equip", unequip).await);
    let sent = env
        .call_with(
            &p.id,
            p.admin.clone(),
            "nft_transfer",
            transfer,
            one_yocto,
            30,
        )
        .await;
    done(sent);
    assert_eq!(env.owner_of(&d).await?, env.stranger.to_string());
    Ok(())
}

/// The worst case for one chunk: a distinct beneficiary per drone, each id as long as a player id
/// can be (`p-<20>.game.hyperdrome.testnet`, 46 characters), so the aggregated ft_mint carries two
/// entries per race; six-digit times in `batch_settled`; token ids counted at 7 characters.
#[tokio::test]
async fn settle_chunk_fits_gas_and_log_budgets() -> R<()> {
    let env = Env::start().await?;
    let owners: Vec<String> = (0..2 * CHUNK)
        .map(|i| format!("p-{i:0>20}.game.hyperdrome.testnet"))
        .collect();
    assert!(owners.iter().all(|o| o.len() == 46));
    for group in owners.chunks(10) {
        let mut calls = Vec::new();
        for o in group {
            calls.push(("register_player", json!({ "account_id": o })));
            let mint = json!({ "owner": o, "name": "WORD-A1", "level": 1, "stats": ONES, "active_hint": true });
            calls.push(("mint_drone", mint));
        }
        done(
            env.multi_call_as(&env.owner, env.signer.clone(), calls, 12)
                .await,
        );
    }
    let ids: Vec<String> = (1..=2 * CHUNK).map(|n| format!("d:{n}")).collect();
    let hash = stats_hash(&env, &ids[0]).await?;

    let mut matchups = Vec::new();
    let mut results = Vec::new();
    for (k, pair) in ids.chunks(2).enumerate() {
        let (a, b) = (&pair[0], &pair[1]);
        let winner = if k % 2 == 0 { a } else { b };
        let ta = 100_000 + u32::try_from(k)? * 997;
        let tb = 150_000 - u32::try_from(k)? * 991;
        matchups.push(matchup(a, b, u8::try_from(k % 16)?));
        results.push(json!({
            "a": a, "b": b, "winner": winner, "time_a_ms": ta, "time_b_ms": tb,
            "stats_hash_a": hash, "stats_hash_b": hash,
        }));
    }
    let out = ok(commit(&env, 1, &matchups).await)?;
    record_gas(&out, &format!("commit_batch ({CHUNK} races)"));

    let out = ok(settle(&env, 1, 0, &results).await)?;
    record_gas(&out, &format!("settle_batch ({CHUNK} races)"));
    let mint = event(&out, "nep141", "ft_mint");
    assert_eq!(mint["data"].as_array().map(Vec::len), Some(2 * CHUNK));
    let logs = out.logs();
    assert_eq!(logs.len(), 2);
    let measured: usize = logs.iter().map(|l| l.len()).sum();
    let id_padding: usize = results
        .iter()
        .map(|r| {
            ["a", "b", "winner"]
                .iter()
                .map(|k| TOKEN_ID_LEN - r[*k].as_str().map_or(0, str::len))
                .sum::<usize>()
        })
        .sum();
    let log_bytes = measured + id_padding;
    println!(
        "CHUNK {CHUNK} races: {:.3} TGas, {measured} log bytes, {log_bytes} with ids at {TOKEN_ID_LEN} chars",
        tgas(&out)
    );
    assert!(
        tgas(&out) <= CHUNK_TGAS_BUDGET,
        "gas {:.3} TGas",
        tgas(&out)
    );
    assert!(log_bytes <= CHUNK_LOG_BYTES_BUDGET, "log bytes {log_bytes}");
    Ok(())
}
