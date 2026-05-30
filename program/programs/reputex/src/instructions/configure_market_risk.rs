use anchor_lang::prelude::*;

use crate::constants::{BASIS_POINTS, MARKET_SEED, PROTOCOL_SEED};
use crate::errors::ReputexError;
use crate::events::MarketRiskConfigured;
use crate::state::{Market, Protocol};

#[derive(Accounts)]
#[instruction(market_index: u64)]
pub struct ConfigureMarketRisk<'info> {
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

    pub authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<ConfigureMarketRisk>,
    _market_index: u64,
    max_open_interest: u64,
    max_skew_bps: u64,
    max_funding_rate_bps: u64,
    funding_interval_slots: u64,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.protocol.authority,
        ReputexError::Unauthorized
    );
    require!(max_open_interest > 0, ReputexError::InvalidRiskParameter);
    require!(max_skew_bps <= BASIS_POINTS, ReputexError::InvalidRiskParameter);
    require!(
        max_funding_rate_bps <= BASIS_POINTS,
        ReputexError::InvalidRiskParameter
    );
    require!(
        funding_interval_slots > 0,
        ReputexError::InvalidRiskParameter
    );

    let market = &mut ctx.accounts.market;
    market.max_open_interest = max_open_interest;
    market.max_skew_bps = max_skew_bps;
    market.max_funding_rate_bps = max_funding_rate_bps;
    market.funding_interval_slots = funding_interval_slots;

    emit!(MarketRiskConfigured {
        market_index: market.market_index,
        max_open_interest,
        max_skew_bps,
        max_funding_rate_bps,
        funding_interval_slots,
    });

    Ok(())
}
