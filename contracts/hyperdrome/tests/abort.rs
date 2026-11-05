//! Sandbox tests for `abort_batch`, matchup pruning and the V1 batch upgrade (SPEC.md 4.2, 4.4,
//! 4.5): an abort unlocks the drones still in the batch and mints nothing; a settled or aborted
//! batch refuses both `settle_batch` and `abort_batch` with `settled`; the final settle and the
//! abort empty the matchups so the contract's storage shrinks; a batch committed by the T6 build
//! still reads, settles and aborts after a redeploy of this build.

#[allow(dead_code)] // each test binary uses a subset of the shared helpers
mod common;

use common::batches::{ONES, commit, drone, matchup, mint_bots, record, result, settle};
use common::{Env, R, assert_fails, done, event, ok, record_gas};
use near_api::Contract;
use near_sdk::serde_json::{Value, json};

/// The wasm deployed to game.hyperdrome.testnet by T6 (code hash
/// `B9An2ovtdjJHYF7Xy3Kio7qtYtd6f3r3orpG3shNRvTp`, HANDOFF.md 2026-11-03), whose batches are
/// `VersionedBatch::V1`.
const T6_WASM: &[u8] = include_bytes!("fixtures/hyperdrome-t6.wasm");
const T6_WASM_SHA256: &str = "96ac91e806a56ad064ee276d0fe1956efb0e0968fad74b37a20c4789be493c17";

async fn abort(
    env: &Env,
    batch_id: u64,
) -> Result<near_api::types::transaction::result::ExecutionFinalResult, String> {
    env.call(&env.game, "abort_batch", json!({ "batch_id": batch_id }))
        .await
}

async fn batch(env: &Env, id: u64) -> R<Value> {
    env.view("get_batch", json!({ "id": id })).await
}

/// `(settled, settled_count, aborted, matchup count)` of a batch.
fn summary(b: &Value) -> (bool, u64, bool, usize) {
    (
        b["settled"] == true,
        b["settled_count"].as_u64().unwrap_or(u64::MAX),
        b["aborted"] == true,
        b["matchups"].as_array().map_or(usize::MAX, Vec::len),
    )
}

async fn storage_usage(env: &Env) -> R<u64> {
    Ok(near_api::Account(env.game.clone())
        .view()
        .fetch_from(&env.net)
        .await?
        .data
        .storage_usage)
}

#[tokio::test]
async fn abort_unlocks_drones_mints_nothing_and_refuses_settled_batches() -> R<()> {
    let env = Env::start().await?;
    let p = env.funded_player("pilot", false, 0).await?;
    let mut ids = Vec::new();
    for _ in 0..4 {
        ids.push(env.mint_drone(&p.id, ONES).await?);
    }
    let (a, b, c, d) = (&ids[0], &ids[1], &ids[2], &ids[3]);

    for caller in [&env.stranger, &env.owner] {
        assert_fails(
            env.call(caller, "abort_batch", json!({ "batch_id": 1 }))
                .await,
            "Method abort_batch is private",
        );
    }
    assert_fails(abort(&env, 1).await, "not found");

    done(commit(&env, 1, &[matchup(a, b, 0)]).await);
    let before = storage_usage(&env).await?;
    let out = ok(abort(&env, 1).await)?;
    record_gas(&out, "abort_batch (1 race)");
    assert_eq!(out.logs().len(), 1, "no ft_mint");
    assert_eq!(
        event(&out, "hyperdrome", "batch_aborted")["data"],
        json!({ "batch_id": 1, "count": 2 })
    );
    assert_eq!(env.volts(&p.id).await?, 0);
    for token in [a, b] {
        let (got, in_batch) = record(&env, token).await?;
        assert_eq!(got, (1_000, 0, 1, 0, 0), "{token} unchanged");
        assert_eq!(in_batch, Value::Null, "{token} unlocked");
        assert_eq!(drone(&env, token).await?["locked"], false);
    }
    assert_eq!(summary(&batch(&env, 1).await?), (false, 0, true, 0));
    assert!(
        storage_usage(&env).await? < before,
        "abort refunds the matchups"
    );

    assert_fails(abort(&env, 1).await, "settled");
    let r = result(&env, a, b, a, 60_000, 61_000).await?;
    assert_fails(settle(&env, 1, 0, &[r]).await, "settled");

    // Aborted drones race again; a settled batch cannot be aborted.
    done(commit(&env, 2, &[matchup(a, b, 0)]).await);
    let r = result(&env, a, b, b, 61_000, 60_000).await?;
    done(settle(&env, 2, 0, &[r]).await);
    assert_fails(abort(&env, 2).await, "settled");

    // A partly settled batch aborts: only the drones still in it are unlocked, so a drone that
    // settled and entered a later batch stays there.
    done(commit(&env, 3, &[matchup(a, b, 0), matchup(c, d, 0)]).await);
    let r = result(&env, a, b, a, 60_000, 61_000).await?;
    done(settle(&env, 3, 0, &[r]).await);
    done(commit(&env, 4, &[matchup(a, b, 0)]).await);
    let out = ok(abort(&env, 3).await)?;
    assert_eq!(
        event(&out, "hyperdrome", "batch_aborted")["data"],
        json!({ "batch_id": 3, "count": 2 })
    );
    assert_eq!(summary(&batch(&env, 3).await?), (false, 1, true, 0));
    for token in [a, b] {
        assert_eq!(
            record(&env, token).await?.1,
            json!(4),
            "{token} stays in batch 4"
        );
    }
    for token in [c, d] {
        assert_eq!(
            record(&env, token).await?.1,
            Value::Null,
            "{token} unlocked"
        );
    }
    Ok(())
}

/// Races in the pruning test: one full settlement chunk (SPEC.md 13), so the abort gas recorded
/// here is the chunk-size worst case.
const RACES: u64 = 40;

#[tokio::test]
async fn final_settle_empties_matchups_and_shrinks_storage() -> R<()> {
    let env = Env::start().await?;
    let mut bots = Vec::new();
    for first in (1..=2 * RACES).step_by(20) {
        bots.extend(mint_bots(&env, first, 20).await?);
    }
    let pairs: Vec<(&str, &str)> = bots
        .chunks(2)
        .map(|c| (c[0].as_str(), c[1].as_str()))
        .collect();
    let matchups: Vec<Value> = pairs.iter().map(|(a, b)| matchup(a, b, 2)).collect();
    let half = usize::try_from(RACES / 2)?;

    // Abort of a full chunk: gas recorded (SPEC.md 13 budget 30 TGas), storage refunded.
    let empty = storage_usage(&env).await?;
    done(commit(&env, 8, &matchups).await);
    let committed = storage_usage(&env).await?;
    assert!(committed > empty, "commit stores the matchups");
    let out = ok(abort(&env, 8).await)?;
    record_gas(&out, &format!("abort_batch ({RACES} races)"));
    assert_eq!(
        event(&out, "hyperdrome", "batch_aborted")["data"]["count"],
        2 * RACES
    );
    assert!(
        storage_usage(&env).await? < committed,
        "abort refunds the matchups"
    );

    done(commit(&env, 9, &matchups).await);
    let committed = storage_usage(&env).await?;
    let mut results = Vec::new();
    for (a, b) in &pairs {
        results.push(result(&env, a, b, a, 50_000, 51_000).await?);
    }

    done(settle(&env, 9, 0, &results[..half]).await);
    assert_eq!(
        summary(&batch(&env, 9).await?),
        (false, RACES / 2, false, usize::try_from(RACES)?)
    );
    assert!(
        storage_usage(&env).await? + 9 * RACES >= committed,
        "an open batch keeps its matchups (only the settled drones' in_batch bytes go)"
    );

    done(settle(&env, 9, half as u32, &results[half..]).await);
    assert_eq!(summary(&batch(&env, 9).await?), (true, RACES, false, 0));
    let settled = storage_usage(&env).await?;
    assert!(
        settled < committed,
        "storage after the final settle ({settled}) is below the usage after commit ({committed})"
    );
    let r = result(&env, pairs[0].0, pairs[0].1, pairs[0].0, 50_000, 51_000).await?;
    assert_fails(
        settle(&env, 9, u32::try_from(RACES)?, &[r]).await,
        "settled",
    );
    Ok(())
}

#[tokio::test]
async fn v1_batch_reads_settles_and_aborts_after_upgrade() -> R<()> {
    let digest = near_sdk::env::sha256_array(T6_WASM);
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(hex, T6_WASM_SHA256, "the fixture is the T6 deploy");

    let env = Env::start_with(T6_WASM.to_vec()).await?;
    let p = env.funded_player("pilot", false, 0).await?;
    let mut ids = Vec::new();
    for _ in 0..4 {
        ids.push(env.mint_drone(&p.id, ONES).await?);
    }
    let (a, b, c, d) = (&ids[0], &ids[1], &ids[2], &ids[3]);
    done(commit(&env, 1, &[matchup(a, b, 0)]).await);
    done(commit(&env, 2, &[matchup(c, d, 1)]).await);
    let v1: Value = batch(&env, 1).await?;
    assert_eq!(v1.get("aborted"), None, "T6 batches have no aborted field");

    Contract::deploy(env.game.clone())
        .use_code(common::wasm())
        .with_init_call("migrate", json!({}))?
        .with_signer(env.signer.clone())
        .send_to(&env.net)
        .await?
        .assert_success();

    let read = batch(&env, 1).await?;
    assert_eq!(summary(&read), (false, 0, false, 1));
    assert_eq!(read["matchups"], v1["matchups"]);
    assert_eq!(read["seed_hash"], v1["seed_hash"]);
    assert_eq!(read["committed_at_ms"], v1["committed_at_ms"]);
    assert_eq!(record(&env, a).await?.1, json!(1));

    let r = result(&env, a, b, a, 60_000, 61_000).await?;
    let out = ok(settle(&env, 1, 0, &[r]).await)?;
    assert_eq!(
        event(&out, "hyperdrome", "batch_settled")["data"]["batch_id"],
        1
    );
    assert_eq!(summary(&batch(&env, 1).await?), (true, 1, false, 0));
    assert_eq!(record(&env, a).await?.1, Value::Null);
    assert_eq!(env.volts(&p.id).await?, 3 + 1);

    let out = ok(abort(&env, 2).await)?;
    assert_eq!(
        event(&out, "hyperdrome", "batch_aborted")["data"],
        json!({ "batch_id": 2, "count": 2 })
    );
    assert_eq!(summary(&batch(&env, 2).await?), (false, 0, true, 0));
    assert_eq!(record(&env, c).await?.1, Value::Null);
    Ok(())
}
