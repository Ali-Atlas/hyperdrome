use crate::constants::catalog::{
    ACCELERATION, CONSISTENCY, SPEED, TURNING, WIND_RESISTANCE, mod_template,
};
use crate::math::{
    allocation_cost, apply_mod, apply_pct, effective_stats, elo_deltas, expected_winner, stat_cap,
    stat_sum, tier, tsb, upgrade_cost, xp_to_next,
};

#[test]
fn total_stat_budget() {
    assert_eq!([1, 2, 10, 20].map(tsb), [29, 49, 209, 409]);
}

#[test]
fn per_stat_cap() {
    // min(100, 10 + floor(4.5 * L))
    assert_eq!(
        [1, 2, 3, 4, 10, 19, 20].map(stat_cap),
        [14, 19, 23, 28, 55, 95, 100]
    );
}

#[test]
fn upgrade_and_allocation_cost() {
    assert_eq!(
        [0, 1, 9, 10, 19, 20, 99].map(upgrade_cost),
        [1, 1, 1, 2, 2, 3, 10]
    );
    let from = [1u8; 9];
    let mut to = from;
    to[0] = 11; // 1..=9 cost 1 each, 10 costs 2
    assert_eq!(allocation_cost(&from, &to), Some(11));
    to[1] = 3;
    assert_eq!(allocation_cost(&from, &to), Some(13));
    let mut down = from;
    down[2] = 0;
    assert_eq!(allocation_cost(&from, &down), None, "stats never decrease");
    assert_eq!(allocation_cost(&from, &from), Some(0));
}

#[test]
fn xp_tier_and_sum() {
    assert_eq!([1, 2, 19].map(xp_to_next), [200, 800, 72_200]);
    assert_eq!(
        [1, 5, 6, 10, 11, 15, 16, 20, 25].map(tier),
        [1, 1, 2, 2, 3, 3, 4, 4, 4]
    );
    assert_eq!(stat_sum(&[1, 2, 3, 4, 5, 6, 7, 8, 9]), 45);
}

#[test]
fn percent_rounding_and_clamp() {
    assert_eq!(
        apply_pct(50, 4),
        52,
        "+4 rare on 50 gives +2 (DECISIONS.md 5.2)"
    );
    assert_eq!(apply_pct(50, -2), 49);
    assert_eq!(apply_pct(25, 2), 26, "25.5 rounds up");
    assert_eq!(apply_pct(1, -6), 1, "clamped at 1");
    assert_eq!(apply_pct(100, 8), 100, "clamped at 100");
    assert_eq!(apply_pct(10, -5), 10, "9.5 rounds up to 10");
}

#[test]
fn mod_bonus_and_penalty_apply_before_scoring() {
    let stats = [50u8; 9];
    let aero = mod_template(11).expect("Aero Shell");
    let out = apply_mod(&stats, aero);
    assert_eq!(out[usize::from(SPEED)], 52);
    assert_eq!(out[usize::from(TURNING)], 49);
    assert_eq!(stat_sum(&out), 450 + 2 - 1);
    let plasma = effective_stats(&stats, 19);
    assert_eq!(
        (
            plasma[usize::from(ACCELERATION)],
            plasma[usize::from(CONSISTENCY)]
        ),
        (53, 48)
    );
    let phantom = effective_stats(&stats, 24);
    assert_eq!(
        phantom[usize::from(WIND_RESISTANCE)],
        48,
        "legendary: penalty only"
    );
    assert_eq!(stat_sum(&phantom), 448);
    assert_eq!(effective_stats(&stats, 0), stats, "no mod");
}

#[test]
fn expected_score_fixed_point() {
    assert_eq!(expected_winner(0), 500_000);
    // 10^(400/400) = 10 -> 1 / 11
    assert_eq!(expected_winner(400), 90_909);
    assert_eq!(expected_winner(-400), 1_000_000 - 90_909);
    assert_eq!(
        expected_winner(5_000),
        expected_winner(800),
        "clamped to 800"
    );
    // Interpolated between k = 0 and k = 25.
    let mid = expected_winner(12);
    assert!(mid < 500_000 && mid > expected_winner(25));
}

#[test]
fn elo_deltas_k32() {
    assert_eq!(elo_deltas(1000, 1000), (16, -16));
    // Favourite (+400) beats underdog: expected 0.909, gains ~3.
    assert_eq!(elo_deltas(1400, 1000), (3, -29));
    // Underdog beats favourite: gains ~29.
    assert_eq!(elo_deltas(1000, 1400), (29, -3));
}
