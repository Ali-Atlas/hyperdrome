//! Race settlement (SPEC.md 4.4), callable only by the contract account through the settlement
//! key. `commit_batch` stores the seed hash and matchups and puts every drone in the batch;
//! `settle_batch` reveals the seed and applies results in contiguous chunks: payouts, ELO, XP,
//! level-ups and records per race, with the chunk's Volts minted in one aggregated `ft_mint`;
//! `abort_batch` unlocks a batch that can no longer be settled, paying nothing. A batch's
//! matchups are emptied once it is settled or aborted, so their storage stake is refunded.

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U128;
use near_sdk::{AccountId, env, near, require};

use crate::constants::tables::{TIME_OF_DAY, TRACKS, WEATHER};
use crate::constants::{LEVEL_UP_VOLTS, XP_LOSS, XP_WIN};
use crate::events::{Event, SettledRace};
use crate::math::{elo_deltas, gain_xp, loser_payout, winner_payout};
use crate::types::{Batch, DroneHot, Matchup, RaceResult, VersionedBatch, VersionedDroneHot};
use crate::{Contract, ContractExt};

/// One drone's side of a settled race after it is applied.
struct SideOutcome {
    elo: i32,
    xp: u32,
    level: u8,
    /// Volts minted for the drone in this race (0 with no beneficiary).
    volts: u128,
}

/// Volts to mint in one settle call: one entry per beneficiary, in order of first appearance.
#[derive(Default)]
struct Mints(Vec<(AccountId, u128)>);

impl Mints {
    fn add(&mut self, to: AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        match self.0.iter_mut().find(|(a, _)| *a == to) {
            Some((_, total)) => *total += amount,
            None => self.0.push((to, amount)),
        }
    }
}

#[near]
impl Contract {
    /// Contract account only (settlement key). Commits batch `batch_id`: stores `seed_hash`, the
    /// block time and `matchups`, and sets `in_batch` on every drone; listed (escrowed) drones may
    /// race. Emits `batch_committed {batch_id, count}`. Fails with "Method commit_batch is
    /// private", "exists" (batch id stored), "not found" (unknown drone, or a track, weather or
    /// time of day outside the tables) or "locked" (drone already in an unsettled batch, or listed
    /// twice in `matchups`).
    #[private]
    pub fn commit_batch(&mut self, batch_id: u64, seed_hash: [u8; 32], matchups: Vec<Matchup>) {
        require!(!self.s().batches.contains_key(&batch_id), "exists");
        for m in &matchups {
            require!(
                usize::from(m.track) < TRACKS.len()
                    && usize::from(m.weather) < WEATHER.len()
                    && usize::from(m.tod) < TIME_OF_DAY.len(),
                "not found"
            );
            self.enter_batch(&m.a, batch_id);
            self.enter_batch(&m.b, batch_id);
        }
        let count = u32::try_from(matchups.len()).unwrap_or_else(|_| env::panic_str("bad chunk"));
        let batch = Batch {
            seed_hash,
            committed_at_ms: env::block_timestamp_ms(),
            matchups,
            settled: false,
            settled_count: 0,
            aborted: false,
        };
        self.s_mut()
            .batches
            .insert(batch_id, VersionedBatch::V2(batch));
        Event::BatchCommitted { batch_id, count }.emit();
    }

    /// Contract account only (settlement key). Settles races `from .. from + results.len()` of
    /// batch `batch_id` with the revealed `seed`. Per race: payouts (SPEC.md 2.3) from the
    /// pre-race levels and ELOs, ELO (4.6), XP 10/4, level-ups (+20 Volts each), wins and losses,
    /// and `in_batch` cleared on both drones. Volts go to each drone's beneficiary (its owner; the
    /// listing's seller when escrowed; nobody for bots or accounts not registered for Volts).
    /// Advances `settled_count`; the batch is settled when it reaches the matchup count, and its
    /// matchups are then emptied (storage refund). Emits one aggregated nep141 ft_mint (when
    /// anything is minted), then one `batch_settled`. Fails with "Method settle_batch is
    /// private", "not found", "bad seed", "settled" (settled or aborted batch, or races already
    /// settled), "bad chunk" or "state drift"; any failure reverts the whole call.
    #[private]
    pub fn settle_batch(
        &mut self,
        batch_id: u64,
        seed: [u8; 32],
        from: u32,
        results: Vec<RaceResult>,
    ) {
        let batch = self
            .batch(batch_id)
            .unwrap_or_else(|| env::panic_str("not found"));
        require!(env::sha256_array(seed) == batch.seed_hash, "bad seed");
        require!(
            !batch.settled && !batch.aborted && from >= batch.settled_count,
            "settled"
        );
        require!(from == batch.settled_count, "bad chunk");
        let total = batch.matchups.len();
        let start = usize::try_from(from).unwrap_or(usize::MAX);
        let end = start
            .checked_add(results.len())
            .filter(|&end| end <= total)
            .unwrap_or_else(|| env::panic_str("bad chunk"));
        let matchups = batch.matchups[start..end].to_vec();

        let mut mints = Mints::default();
        let mut races = Vec::with_capacity(results.len());
        for (i, (m, r)) in (from..).zip(matchups.iter().zip(&results)) {
            races.push(self.settle_race(i, m, r, &mut mints));
        }

        if let Some(b) = self.batch_mut(batch_id) {
            b.settled_count = u32::try_from(end).unwrap_or_else(|_| env::panic_str("bad chunk"));
            b.settled = end == total;
            if b.settled {
                b.matchups = Vec::new();
            }
        }
        let volts = &mut self.s_mut().volts;
        for (to, amount) in &mints.0 {
            volts.internal_deposit(to, *amount);
        }
        let entries: Vec<FtMint<'_>> = mints
            .0
            .iter()
            .map(|(to, amount)| FtMint {
                owner_id: to,
                amount: U128(*amount),
                memo: None,
            })
            .collect();
        if !entries.is_empty() {
            FtMint::emit_many(&entries);
        }
        Event::BatchSettled { batch_id, races }.emit();
    }

    /// Contract account only (settlement key). Aborts batch `batch_id`: clears `in_batch` on every
    /// drone still in it, empties its matchups (storage refund), marks it aborted and pays
    /// nothing; the batch can no longer be settled. Emits `batch_aborted {batch_id, count}` with
    /// the number of drones unlocked. Fails with "Method abort_batch is private", "not found" or
    /// "settled" (the batch is settled or already aborted).
    #[private]
    pub fn abort_batch(&mut self, batch_id: u64) {
        let batch = self
            .batch_mut(batch_id)
            .unwrap_or_else(|| env::panic_str("not found"));
        require!(!batch.settled && !batch.aborted, "settled");
        batch.aborted = true;
        let matchups = std::mem::take(&mut batch.matchups);
        let mut count = 0u32;
        for drone in matchups.iter().flat_map(|m| [&m.a, &m.b]) {
            if let Some(VersionedDroneHot::V1(hot)) = self.s_mut().drones_hot.get_mut(drone)
                && hot.in_batch == Some(batch_id)
            {
                hot.in_batch = None;
                count += 1;
            }
        }
        Event::BatchAborted { batch_id, count }.emit();
    }
}

impl Contract {
    /// Puts `drone` in batch `batch_id`: "not found" if it does not exist, "locked" if it is
    /// already in a batch (an unsettled one, or this one when listed twice).
    fn enter_batch(&mut self, drone: &TokenId, batch_id: u64) {
        let Some(VersionedDroneHot::V1(hot)) = self.s_mut().drones_hot.get_mut(drone) else {
            env::panic_str("not found")
        };
        require!(hot.in_batch.is_none(), "locked");
        hot.in_batch = Some(batch_id);
    }

    /// Validates one result against its matchup and the drones' current state ("bad chunk": wrong
    /// pair, winner not in the pair, a zero time, or a winner slower than the loser; "state
    /// drift"), applies it and returns its `batch_settled` entry. Volts to mint go to `mints`.
    fn settle_race(
        &mut self,
        i: u32,
        m: &Matchup,
        r: &RaceResult,
        mints: &mut Mints,
    ) -> SettledRace {
        require!(r.a == m.a && r.b == m.b, "bad chunk");
        require!(r.winner == r.a || r.winner == r.b, "bad chunk");
        require!(r.time_a_ms > 0 && r.time_b_ms > 0, "bad chunk");
        let (time_w, time_l) = if r.winner == r.a {
            (r.time_a_ms, r.time_b_ms)
        } else {
            (r.time_b_ms, r.time_a_ms)
        };
        // Equal times are the engine's tie-break (SPEC.md 2.4), so either drone may win them.
        require!(time_w <= time_l, "bad chunk");
        require!(
            self.stats_hash_of(&r.a) == Some(r.stats_hash_a)
                && self.stats_hash_of(&r.b) == Some(r.stats_hash_b),
            "state drift"
        );
        let hot_a = self.race_drone(&r.a);
        let hot_b = self.race_drone(&r.b);
        let a_won = r.winner == r.a;
        let (w, l) = if a_won {
            (&hot_a, &hot_b)
        } else {
            (&hot_b, &hot_a)
        };
        let difficulty = TRACKS
            .get(usize::from(m.track))
            .map_or_else(|| env::panic_str("not found"), |t| t.difficulty);
        let win_volts = winner_payout(w.level, difficulty, w.elo, l.elo, r.time_a_ms, r.time_b_ms);
        let lose_volts = loser_payout(l.level);
        let (gain, loss) = elo_deltas(w.elo, l.elo);
        let elo_w = w.elo.saturating_add(gain);
        let elo_l = l.elo.saturating_add(loss);

        let (side_a, side_b) = if a_won {
            ((elo_w, win_volts), (elo_l, lose_volts))
        } else {
            ((elo_l, lose_volts), (elo_w, win_volts))
        };
        let out_a = self.apply_side(&r.a, hot_a, a_won, side_a, mints);
        let out_b = self.apply_side(&r.b, hot_b, !a_won, side_b, mints);
        SettledRace {
            i,
            a: r.a.clone(),
            b: r.b.clone(),
            winner: r.winner.clone(),
            ta: r.time_a_ms,
            tb: r.time_b_ms,
            va: U128(out_a.volts),
            vb: U128(out_b.volts),
            elo_a: out_a.elo,
            elo_b: out_b.elo,
            xp_a: out_a.xp,
            xp_b: out_b.xp,
            lvl_a: out_a.level,
            lvl_b: out_b.level,
        }
    }

    fn race_drone(&self, drone: &TokenId) -> DroneHot {
        self.drone_hot(drone)
            .cloned()
            .unwrap_or_else(|| env::panic_str("not found"))
    }

    /// Writes one drone's post-race state: `elo` from `(elo, payout)`, XP and level-ups, the win
    /// or loss, `in_batch` cleared. Adds the payout plus 20 Volts per level gained to `mints`
    /// when the drone has a beneficiary.
    fn apply_side(
        &mut self,
        drone: &TokenId,
        mut hot: DroneHot,
        won: bool,
        (elo, payout): (i32, u128),
        mints: &mut Mints,
    ) -> SideOutcome {
        let gained = if won { XP_WIN } else { XP_LOSS };
        let (level, xp, ups) = gain_xp(hot.level, hot.xp, gained);
        let earned = payout + LEVEL_UP_VOLTS * u128::from(ups);
        let volts = match self.volts_beneficiary(drone) {
            Some(to) => {
                mints.add(to, earned);
                earned
            }
            None => 0,
        };
        hot.elo = elo;
        hot.xp = xp;
        hot.level = level;
        if won {
            hot.wins = hot.wins.saturating_add(1);
        } else {
            hot.losses = hot.losses.saturating_add(1);
        }
        hot.in_batch = None;
        self.s_mut()
            .drones_hot
            .insert(drone.clone(), VersionedDroneHot::V1(hot));
        SideOutcome {
            elo,
            xp,
            level,
            volts,
        }
    }

    /// Who receives a drone's race Volts: its owner; the listing's seller when the contract holds
    /// it in escrow; nobody for contract-owned bots or an account not registered for Volts.
    fn volts_beneficiary(&self, drone: &TokenId) -> Option<AccountId> {
        let owner = self.token_owner(drone)?;
        let to = if owner == env::current_account_id() {
            self.s().listings.get(drone)?.seller.clone()
        } else {
            owner
        };
        self.s().volts.accounts.contains_key(&to).then_some(to)
    }
}
