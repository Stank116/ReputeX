use anchor_lang::prelude::*;

use crate::constants::{BASIS_POINTS, MARKET_SEED, MAX_PRICE_DECIMALS, PROTOCOL_SEED};
use crate::errors::ReputexError;
use crate::events::MarketOracleConfigured;
use crate::state::{Market, Protocol};

#[derive(Accounts)]
#[instruction(market_index: u64)]
pub struct ConfigureMarketOracle<'info> {
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
    ctx: Context<ConfigureMarketOracle>,
    _market_index: u64,
    oracle_feed_id: [u8; 32],
    oracle_max_age_seconds: u64,
    oracle_max_confidence_bps: u64,
    price_decimals: u8,
    oracle_enabled: bool,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.protocol.authority,
        ReputexError::Unauthorized
    );
    require!(
        oracle_feed_id != [0; 32],
        ReputexError::InvalidRiskParameter
    );
    require!(
        oracle_max_age_seconds > 0,
        ReputexError::InvalidRiskParameter
    );
    require!(
        oracle_max_confidence_bps <= BASIS_POINTS,
        ReputexError::InvalidRiskParameter
    );
    require!(
        price_decimals <= MAX_PRICE_DECIMALS,
        ReputexError::InvalidRiskParameter
    );

    let market = &mut ctx.accounts.market;
    market.oracle_feed_id = oracle_feed_id;
    market.oracle_max_age_seconds = oracle_max_age_seconds;
    market.oracle_max_confidence_bps = oracle_max_confidence_bps;
    market.price_decimals = price_decimals;
    market.oracle_enabled = oracle_enabled;

    emit!(MarketOracleConfigured {
        market_index: market.market_index,
        oracle_feed_id,
        oracle_max_age_seconds,
        oracle_max_confidence_bps,
        price_decimals,
        oracle_enabled,
    });

    Ok(())
}
