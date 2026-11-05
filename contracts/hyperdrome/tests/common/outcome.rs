//! Reading a transaction outcome: its NEP-297 events and the gas it burnt.

use near_api::types::transaction::result::ExecutionFinalResult;
use near_sdk::serde_json::Value;

/// Every NEP-297 event logged by the transaction, as JSON.
pub fn events(out: &ExecutionFinalResult) -> Vec<Value> {
    out.logs()
        .into_iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .filter_map(|j| near_sdk::serde_json::from_str(j).ok())
        .collect()
}

/// The single event with this standard and name; panics if there is not exactly one.
#[track_caller]
pub fn event(out: &ExecutionFinalResult, standard: &str, name: &str) -> Value {
    let found: Vec<Value> = events(out)
        .into_iter()
        .filter(|e| e["standard"] == standard && e["event"] == name)
        .collect();
    assert_eq!(
        found.len(),
        1,
        "expected one {standard}/{name} event, got {found:?}"
    );
    found[0].clone()
}

pub fn tgas(out: &ExecutionFinalResult) -> f64 {
    out.total_gas_burnt.as_gas() as f64 / 1e12
}

/// Prints the gas `out` burnt. SPEC.md 13 asserts only settlement gas; other methods are measured
/// on testnet and recorded in HANDOFF.md, so this records without asserting.
pub fn record_gas(out: &ExecutionFinalResult, method: &str) {
    println!("GAS {method} {:.3} TGas", tgas(out));
}

/// The NEP-297 events of `standard` named `name`, in log order.
pub fn events_named(out: &ExecutionFinalResult, standard: &str, name: &str) -> Vec<Value> {
    events(out)
        .into_iter()
        .filter(|e| e["standard"] == standard && e["event"] == name)
        .collect()
}
