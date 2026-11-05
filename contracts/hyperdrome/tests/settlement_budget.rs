//! Sandbox test for the settlement chunk budget (SPEC.md 13): one chunk of `CHUNK` races in the
//! worst case must fit the gas and log budgets.

#[allow(dead_code)] // each test binary uses a subset of the shared helpers
mod common;

use common::batches::{ONES, commit, matchup, settle, stats_hash};
use common::{Env, R, done, event, ok, record_gas, tgas};
use near_sdk::serde_json::{Value, json};

/// SPEC.md 13: one chunk of `CHUNK` races burns at most 150 TGas and logs at most 14,000 bytes.
/// 50 races logged 15,779 bytes in the worst case below, so the chunk is 40.
const CHUNK: usize = 40;
const CHUNK_TGAS_BUDGET: f64 = 150.0;
const CHUNK_LOG_BYTES_BUDGET: usize = 14_000;
/// Widths each `batch_settled` field is counted at in the log budget, its longest realistic value:
/// token ids "d:99999", XP 72,199 (5 digits, L19), levels 20, Volts per race at most 51, ELO 4
/// digits. `ft_mint` amounts are counted at 2 digits.
const FIELD_WIDTHS: [(&str, usize); 11] = [
    ("a", 7),
    ("b", 7),
    ("winner", 7),
    ("xp_a", 5),
    ("xp_b", 5),
    ("lvl_a", 2),
    ("lvl_b", 2),
    ("va", 2),
    ("vb", 2),
    ("elo_a", 4),
    ("elo_b", 4),
];
const MINT_AMOUNT_WIDTH: usize = 2;

/// Characters `value` (a JSON string or number) falls short of `width`.
fn shortfall(value: &Value, width: usize) -> usize {
    let len = value
        .as_str()
        .map_or_else(|| value.to_string().len(), str::len);
    width.saturating_sub(len)
}

/// The worst case for one chunk: a distinct beneficiary per drone, each id as long as a player id
/// can be (`p-<20>.game.hyperdrome.testnet`, 46 characters), so the aggregated ft_mint carries two
/// entries per race; six-digit times in `batch_settled`; other fields counted at `FIELD_WIDTHS`.
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
        let ta = 100_000 + u32::try_from(k)? * 997;
        let tb = 150_000 - u32::try_from(k)? * 991;
        let winner = if ta <= tb { a } else { b };
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
    let races = event(&out, "hyperdrome", "batch_settled")["data"]["races"].clone();
    let race_padding: usize = races
        .as_array()
        .map(|rs| {
            rs.iter()
                .flat_map(|r| FIELD_WIDTHS.iter().map(move |(k, w)| shortfall(&r[*k], *w)))
                .sum()
        })
        .unwrap_or(0);
    let mint_padding: usize = mint["data"]
        .as_array()
        .map(|es| {
            es.iter()
                .map(|e| shortfall(&e["amount"], MINT_AMOUNT_WIDTH))
                .sum()
        })
        .unwrap_or(0);
    let log_bytes = measured + race_padding + mint_padding;
    println!(
        "CHUNK {CHUNK} races: {:.3} TGas, {measured} log bytes, {log_bytes} at the longest realistic widths",
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
