//! Sandbox tests for settlement (SPEC.md 4.4): commit and chunked settle, payouts to owners,
//! escrow sellers and nobody for bots, ELO, XP and level-ups, the exact events, every failure path
//! by its panic string, and the lock rule on player methods. The chunk budget test is in
//! `settlement_budget.rs`; abort, pruning and the V1 upgrade are in `abort.rs`.

#[allow(dead_code)] // each test binary uses a subset of the shared helpers
mod common;

use common::batches::{
    ONES, SEED, commit, commit_args, drone, matchup, mint_bots, race, record, result, settle,
    settle_args, win_races,
};
use common::{Env, R, assert_fails, done, event, ok, record_gas};
use near_api::NearToken;
use near_sdk::serde_json::{Value, json};

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
    let slower = result(&env, a, b, b, 60_000, 61_000).await?;
    assert_fails(settle(&env, 1, 0, &[slower]).await, "bad chunk");
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
    for (k, (a, b)) in pairs.iter().enumerate() {
        // Race 1 is a tie: equal times are the engine's tie-break, so B may win them.
        let r = if k == 1 {
            result(&env, a, b, b, 71_000, 71_000).await?
        } else {
            result(&env, a, b, a, 70_000, 72_000).await?
        };
        results.push(r);
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

    // The new owner is not registered for Volts: the race still settles and nobody is paid.
    let registered: Value = env
        .view("storage_balance_of", json!({ "account_id": env.stranger }))
        .await?;
    assert_eq!(registered, Value::Null);
    done(commit(&env, 2, &[matchup(&d, &bot, 0)]).await);
    let r = result(&env, &d, &bot, &d, 60_000, 61_000).await?;
    let out = ok(settle(&env, 2, 0, &[r]).await)?;
    assert_eq!(out.logs().len(), 1, "no ft_mint when nothing is minted");
    let settled = &event(&out, "hyperdrome", "batch_settled")["data"]["races"][0];
    assert_eq!((&settled["va"], &settled["vb"]), (&json!("0"), &json!("0")));
    assert_eq!(drone(&env, &d).await?["hot"]["wins"], 1);
    Ok(())
}
