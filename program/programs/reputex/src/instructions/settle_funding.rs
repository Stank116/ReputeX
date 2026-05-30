use anchor_lang::prelude::*;

use crate::constants::{
    BASIS_POINTS, MARKET_SEED, MAX_FUNDING_PERIODS_PER_UPDATE, PROTOCOL_SEED,
};
use crate::errors::ReputexError;
use crate::events::FundingSettled;
use crate::state::{Market, Protocol};

#[derive(Accounts)]
#[instruction(market_index: u64)]
pub struct SettleFunding<'info> {
    #[account(
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump
    )]
    pub protocol: Account<'info, Protocol>,

    #[account(
        mut,
        seeds = [MARKET_SEED, &market_index.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
}

pub fn handler(ctx: Context<SettleFunding>, _market_index: u64) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let current_slot = Clock::get()?.slot;
    let elapsed_slots = current_slot.saturating_sub(market.last_funding_slot);

    require!(
        elapsed_slots >= market.funding_interval_slots,
        ReputexError::FundingNotReady
    );

    let open_interest = market
        .total_long_size
        .checked_add(market.total_short_size)
        .ok_or(error!(ReputexError::MathOverflow))?;

    if open_interest == 0 {
        market.last_funding_slot = current_slot;
        emit!(FundingSettled {
            market_index: market.market_index,
            funding_delta_bps: 0,
            cumulative_funding_rate_bps: market.cumulative_funding_rate_bps,
            long_open_interest: market.total_long_size,
            short_open_interest: market.total_short_size,
            slot: current_slot,
        });
        return Ok(());
    }

    let elapsed_periods = elapsed_slots
        .checked_div(market.funding_interval_slots)
        .ok_or(error!(ReputexError::MathOverflow))?
        .min(MAX_FUNDING_PERIODS_PER_UPDATE);
    let skew_size = market.total_long_size.abs_diff(market.total_short_size);
    let skew_bps = skew_size
        .checked_mul(BASIS_POINTS)
        .ok_or(error!(ReputexError::MathOverflow))?
        .checked_div(open_interest)
        .ok_or(error!(ReputexError::MathOverflow))?;
    let funding_abs_bps = skew_bps
        .checked_mul(market.max_funding_rate_bps)
        .and_then(|value| value.checked_mul(elapsed_periods))
        .ok_or(error!(ReputexError::MathOverflow))?
        .checked_div(BASIS_POINTS)
        .ok_or(error!(ReputexError::MathOverflow))?;
    let funding_delta_bps = if market.total_long_size >= market.total_short_size {
        funding_abs_bps as i64
    } else {
        -(funding_abs_bps as i64)
    };

    market.cumulative_funding_rate_bps = market
        .cumulative_funding_rate_bps
        .checked_add(funding_delta_bps)
        .ok_or(error!(ReputexError::MathOverflow))?;
    market.last_funding_slot = current_slot;

    emit!(FundingSettled {
        market_index: market.market_index,
        funding_delta_bps,
        cumulative_funding_rate_bps: market.cumulative_funding_rate_bps,
        long_open_interest: market.total_long_size,
        short_open_interest: market.total_short_size,
        slot: current_slot,
    });

    Ok(())
}
