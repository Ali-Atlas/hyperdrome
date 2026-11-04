//! Pure game math (SPEC.md 2.1, 2.4 and 4.6). No storage, no environment.

use crate::constants::catalog::{ModTemplate, mod_template};
use crate::constants::tables::{ELO_DIFF_CLAMP, ELO_SCALE, POW10, POW10_STEP};
use crate::constants::{
    CAP_BASE, CAP_PER_LEVEL_TENTHS, DOMINANCE, ELO_K, LEVEL_CAP, LEVEL_MIN, LOSER_LEVEL_DIVISOR,
    LOSER_PAYOUT_BASE, STAT_MAX, STAT_MIN, STRATEGY_WINDOW_MS, TIER_LEVELS, TIER_MAX, TSB_BASE,
    TSB_PER_LEVEL, WINNER_DIFFICULTY_DIVISOR, WINNER_ELO_GAP_DIVISOR, WINNER_LEVEL_DIVISOR,
    WINNER_PAYOUT_BASE, XP_PER_LEVEL_SQUARED,
};

/// Total stat budget: TSB(L) = 9 + 20 * L.
pub fn tsb(level: u8) -> u32 {
    TSB_BASE + TSB_PER_LEVEL * u32::from(level)
}

/// Per-stat cap: min(100, 10 + floor(4.5 * L)).
pub fn stat_cap(level: u8) -> u8 {
    let cap = CAP_BASE + CAP_PER_LEVEL_TENTHS * u32::from(level) / 10;
    u8::try_from(cap.min(u32::from(STAT_MAX))).unwrap_or(STAT_MAX)
}

/// Cost in Volts of raising one stat from `x` to `x + 1`: 1 + floor(x / 10).
pub fn upgrade_cost(x: u8) -> u64 {
    1 + u64::from(x) / 10
}

/// Cost in Volts of raising every stat from `from` to `to`, or `None` if any stat would decrease.
pub fn allocation_cost(from: &[u8; 9], to: &[u8; 9]) -> Option<u64> {
    from.iter()
        .zip(to.iter())
        .try_fold(0u64, |total, (&a, &b)| {
            if b < a {
                return None;
            }
            Some(total + (a..b).map(upgrade_cost).sum::<u64>())
        })
}

/// Lock rule (SPEC.md 4.4): a drone in an unsettled batch committed at `committed_at_ms` is locked
/// from `committed_at_ms + 120_000` on.
pub fn is_locked_at(committed_at_ms: u64, now_ms: u64) -> bool {
    now_ms >= committed_at_ms.saturating_add(STRATEGY_WINDOW_MS)
}

/// XP needed to go from level `L` to `L + 1`: 200 * L * L.
pub fn xp_to_next(level: u8) -> u32 {
    XP_PER_LEVEL_SQUARED * u32::from(level) * u32::from(level)
}

/// XP after gaining `gained` at `level` with `xp`, applying level-ups (SPEC.md 2.1): while
/// xp >= xp_to_next(level) and level < 20, subtract, level up. Returns (level, xp, levels gained).
pub fn gain_xp(level: u8, xp: u32, gained: u32) -> (u8, u32, u8) {
    let (mut level, mut xp, mut ups) = (level, xp.saturating_add(gained), 0u8);
    while (LEVEL_MIN..LEVEL_CAP).contains(&level) && xp >= xp_to_next(level) {
        xp -= xp_to_next(level);
        level += 1;
        ups += 1;
    }
    (level, xp, ups)
}

/// Dominance bonus (SPEC.md 2.3): 5 if margin > 40%, 2 if margin > 20%, else 0, where
/// margin = |t_a - t_b| * 100 / min(t_a, t_b), compared exactly on the millisecond times.
pub fn dominance_bonus(time_a_ms: u32, time_b_ms: u32) -> u128 {
    let diff = u64::from(time_a_ms.abs_diff(time_b_ms)) * 100;
    let fastest = u64::from(time_a_ms.min(time_b_ms));
    DOMINANCE
        .iter()
        .find(|&&(pct, _)| diff > u64::from(pct) * fastest)
        .map_or(0, |&(_, bonus)| bonus)
}

/// Winner payout (SPEC.md 2.3): 3 + floor(L_w / 2) + floor(difficulty / 2)
/// + max(0, floor((ELO_l - ELO_w) / 100)) + dominance, from pre-race levels and ELOs.
pub fn winner_payout(
    level_winner: u8,
    difficulty: u8,
    elo_winner: i32,
    elo_loser: i32,
    time_a_ms: u32,
    time_b_ms: u32,
) -> u128 {
    let gap = u128::try_from(elo_loser.saturating_sub(elo_winner).max(0)).unwrap_or(0);
    WINNER_PAYOUT_BASE
        + u128::from(level_winner) / WINNER_LEVEL_DIVISOR
        + u128::from(difficulty) / WINNER_DIFFICULTY_DIVISOR
        + gap / WINNER_ELO_GAP_DIVISOR
        + dominance_bonus(time_a_ms, time_b_ms)
}

/// Loser payout (SPEC.md 2.3): 1 + floor(L_l / 4), from the pre-race level.
pub fn loser_payout(level_loser: u8) -> u128 {
    LOSER_PAYOUT_BASE + u128::from(level_loser) / LOSER_LEVEL_DIVISOR
}

/// Art tier: L1-5 tier 1, 6-10 tier 2, 11-15 tier 3, 16 and up tier 4.
pub fn tier(level: u8) -> u8 {
    (1 + level.saturating_sub(1) / TIER_LEVELS).min(TIER_MAX)
}

/// Sum of the 9 stats.
pub fn stat_sum(stats: &[u8; 9]) -> u32 {
    stats.iter().map(|&s| u32::from(s)).sum()
}

/// clamp(round(stat * (100 + pct) / 100), 1, 100); `pct` is negative for a penalty.
pub fn apply_pct(stat: u8, pct: i16) -> u8 {
    let factor = u32::try_from(100 + i32::from(pct)).unwrap_or(0);
    let rounded = (u32::from(stat) * factor + 50) / 100;
    let clamped = rounded.clamp(u32::from(STAT_MIN), u32::from(STAT_MAX));
    u8::try_from(clamped).unwrap_or(STAT_MAX)
}

/// Stats after applying a mod template's bonus and penalty (SPEC.md 2.4). Specials change engine
/// behavior, not stats, so a legendary mod applies only its penalty here.
pub fn apply_mod(stats: &[u8; 9], template: &ModTemplate) -> [u8; 9] {
    let mut out = *stats;
    if let Some(bonus) = template.bonus_stat {
        let i = usize::from(bonus);
        out[i] = apply_pct(out[i], i16::from(template.bonus_pct));
    }
    let p = usize::from(template.penalty_stat);
    out[p] = apply_pct(out[p], -i16::from(template.penalty_pct));
    out
}

/// Effective stats for an equipped mod template id; 0 or an unknown id leaves stats unchanged.
pub fn effective_stats(stats: &[u8; 9], mod_template_id: u16) -> [u8; 9] {
    mod_template(mod_template_id).map_or(*stats, |t| apply_mod(stats, t))
}

/// 10^(d/400) * 1e6 for d in 0..=800, linearly interpolated between `POW10` entries.
fn pow10_scaled(d: u32) -> u64 {
    let i = usize::try_from(d / POW10_STEP).unwrap_or(POW10.len() - 1);
    if i >= POW10.len() - 1 {
        return POW10[POW10.len() - 1];
    }
    let rem = u64::from(d % POW10_STEP);
    POW10[i] + (POW10[i + 1] - POW10[i]) * rem / u64::from(POW10_STEP)
}

/// Expected score of the winner, scaled by 1e6, for d = ELO_loser - ELO_winner (SPEC.md 4.6).
pub fn expected_winner(d: i32) -> u64 {
    let d = d.clamp(-ELO_DIFF_CLAMP, ELO_DIFF_CLAMP);
    match u32::try_from(d) {
        Ok(d) => ELO_SCALE * ELO_SCALE / (ELO_SCALE + pow10_scaled(d)),
        Err(_) => ELO_SCALE - expected_winner(-d),
    }
}

/// ELO changes for one race as (winner gain, loser change), the loser change being <= 0.
pub fn elo_deltas(elo_winner: i32, elo_loser: i32) -> (i32, i32) {
    let e = expected_winner(elo_loser.saturating_sub(elo_winner));
    let gain = (ELO_K * (ELO_SCALE - e) + ELO_SCALE / 2) / ELO_SCALE;
    let loss = (ELO_K * e + ELO_SCALE / 2) / ELO_SCALE;
    (
        i32::try_from(gain).unwrap_or(0),
        -i32::try_from(loss).unwrap_or(0),
    )
}
