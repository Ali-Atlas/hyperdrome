//! Settlement methods (SPEC.md 4.4), callable only by the contract account through the
//! settlement key. Implemented in T6; until then they panic with "not implemented" so the
//! settlement key's method list is valid from the first deploy.

use near_sdk::{env, near};

use crate::types::{Matchup, RaceResult};
use crate::{Contract, ContractExt};

#[near]
impl Contract {
    /// T6. Contract account only. Commits a race batch: seed hash and matchups.
    #[private]
    pub fn commit_batch(&mut self, batch_id: u64, seed_hash: [u8; 32], matchups: Vec<Matchup>) {
        let _ = (batch_id, seed_hash, matchups);
        env::panic_str("not implemented")
    }

    /// T6. Contract account only. Settles a committed batch from the revealed seed and results.
    #[private]
    pub fn settle_batch(&mut self, batch_id: u64, seed: [u8; 32], results: Vec<RaceResult>) {
        let _ = (batch_id, seed, results);
        env::panic_str("not implemented")
    }
}
