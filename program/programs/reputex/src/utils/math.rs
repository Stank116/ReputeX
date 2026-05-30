use anchor_lang::prelude::*;

use crate::constants::BASIS_POINTS;
use crate::errors::ReputexError;

/// Returns position size = collateral * leverage
pub fn calculate_position_size(collateral_amount: u64, leverage: u8) -> Result<u64> {
    collateral_amount
        .checked_mul(leverage as u64)
        .ok_or(error!(ReputexError::MathOverflow))
}

/// Returns PnL in the same units as collateral.
/// Long:  (current_price - entry_price) * size / entry_price
/// Short: (entry_price - current_price) * size / entry_price
pub fn calculate_pnl(
    is_long: bool,
    position_size: u64,
    entry_price: u64,
    current_price: u64,
) -> Result<i64> {
    require!(entry_price > 0, ReputexError::InvalidPrice);
    require!(current_price > 0, ReputexError::InvalidPrice);

    let price_delta = if is_long {
        current_price as i128 - entry_price as i128
    } else {
        entry_price as i128 - current_price as i128
    };

    let pnl = price_delta
        .checked_mul(position_size as i128)
        .ok_or(error!(ReputexError::MathOverflow))?
        .checked_div(entry_price as i128)
        .ok_or(error!(ReputexError::MathOverflow))?;

    i64::try_from(pnl).map_err(|_| error!(ReputexError::MathOverflow))
}

/// Equity = collateral + pnl  (can be negative)
pub fn calculate_equity(collateral_amount: u64, pnl: i64) -> i128 {
    collateral_amount as i128 + pnl as i128
}

/// Maintenance margin threshold = size * maintenance_margin_bps / BASIS_POINTS
pub fn maintenance_margin(position_size: u64, maintenance_margin_bps: u64) -> Result<u64> {
    position_size
        .checked_mul(maintenance_margin_bps)
        .ok_or(error!(ReputexError::MathOverflow))?
        .checked_div(BASIS_POINTS)
        .ok_or(error!(ReputexError::MathOverflow))
}

/// Returns true if position equity has fallen at or below the maintenance margin level
pub fn is_liquidatable(
    collateral_amount: u64,
    position_size: u64,
    pnl: i64,
    maintenance_margin_bps: u64,
) -> Result<bool> {
    let equity = calculate_equity(collateral_amount, pnl);
    let maintenance = maintenance_margin(position_size, maintenance_margin_bps)? as i128;
    Ok(equity <= maintenance)
}

pub fn calculate_funding_pnl(
    is_long: bool,
    position_size: u64,
    entry_funding_rate_bps: i64,
    current_funding_rate_bps: i64,
) -> Result<i64> {
    let funding_delta = current_funding_rate_bps
        .checked_sub(entry_funding_rate_bps)
        .ok_or(error!(ReputexError::MathOverflow))?;
    let abs_delta = funding_delta.unsigned_abs();
    let payment = position_size
        .checked_mul(abs_delta)
        .ok_or(error!(ReputexError::MathOverflow))?
        .checked_div(BASIS_POINTS)
        .ok_or(error!(ReputexError::MathOverflow))?;
    let signed_payment = i64::try_from(payment).map_err(|_| error!(ReputexError::MathOverflow))?;

    if funding_delta >= 0 {
        Ok(if is_long {
            -signed_payment
        } else {
            signed_payment
        })
    } else {
        Ok(if is_long {
            signed_payment
        } else {
            -signed_payment
        })
    }
}

/// On-chain reputation score. Starts at STARTING_REPUTATION_SCORE (100).
/// Increases with wins, experience, volume, and positive PnL.
/// Decreases sharply with liquidations and high average leverage.
pub fn reputation_score(
    total_trades: u64,
    winning_trades: u64,
    liquidations: u64,
    realized_pnl: i64,
    total_volume: u64,
    avg_leverage_x100: u64,
) -> u64 {
    let win_bonus = winning_trades.saturating_mul(8);
    let experience_bonus = total_trades.saturating_mul(3);
    let volume_bonus = total_volume / 1_000;
    let pnl_bonus = if realized_pnl > 0 {
        realized_pnl as u64 / 1_000
    } else {
        0
    };
    // Each liquidation costs 30 points; high leverage (>2x avg) also costs points
    let liquidation_penalty = liquidations.saturating_mul(30);
    let leverage_penalty = avg_leverage_x100.saturating_sub(200) / 20;

    100u64
        .saturating_add(win_bonus)
        .saturating_add(experience_bonus)
        .saturating_add(volume_bonus)
        .saturating_add(pnl_bonus)
        .saturating_sub(liquidation_penalty)
        .saturating_sub(leverage_penalty)
}

/// Reputation-gated leverage tiers, capped by the market max.
pub fn max_leverage_for_reputation(reputation_score: u64, market_max_leverage: u8) -> u8 {
    let reputation_cap = match reputation_score {
        0..=79 => 2,
        80..=119 => 3,
        120..=179 => 4,
        _ => 5,
    };

    reputation_cap.min(market_max_leverage)
}
