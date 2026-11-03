//! Pure game math (SPEC.md 2.1, 2.4 and 4.6). No storage, no environment.

use crate::constants::catalog::{ModTemplate, mod_template};
use crate::constants::tables::{ELO_DIFF_CLAMP, ELO_SCALE, POW10, POW10_STEP};
use crate::constants::{
    CAP_BASE, CAP_PER_LEVEL_TENTHS, ELO_K, STAT_MAX, STAT_MIN, STRATEGY_WINDOW_MS, TIER_LEVELS,
    TIER_MAX, TSB_BASE, TSB_PER_LEVEL, XP_PER_LEVEL_SQUARED,
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
