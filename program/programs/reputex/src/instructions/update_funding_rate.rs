use anchor_lang::prelude::*;

use crate::errors::ReputexError;
use crate::events::FundingRateUpdated;
use crate::state::{Market, Protocol};

#[derive(Accounts)]
#[instruction(market_index: u64)]
pub struct UpdateFundingRate<'info> {
    #[account(
        seeds = [b"protocol"],
        bump = protocol.bump
    )]
    pub protocol: Account<'info, Protocol>,

    #[account(
        mut,
        seeds = [b"market", &market_index.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<UpdateFundingRate>,
    _market_index: u64,
    funding_delta_bps: i64,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.protocol.authority,
        ReputexError::Unauthorized
    );
    require!(
        funding_delta_bps.unsigned_abs() <= ctx.accounts.market.max_funding_rate_bps,
        ReputexError::FundingRateTooLarge
    );

    ctx.accounts.market.cumulative_funding_rate_bps = ctx
        .accounts
        .market
        .cumulative_funding_rate_bps
        .checked_add(funding_delta_bps)
        .ok_or(error!(ReputexError::MathOverflow))?;
    ctx.accounts.market.last_funding_slot = Clock::get()?.slot;

    emit!(FundingRateUpdated {
        market_index: ctx.accounts.market.market_index,
        funding_delta_bps,
        cumulative_funding_rate_bps: ctx.accounts.market.cumulative_funding_rate_bps,
        slot: ctx.accounts.market.last_funding_slot,
    });

    Ok(())
}
