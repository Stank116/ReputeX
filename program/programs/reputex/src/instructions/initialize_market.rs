use anchor_lang::prelude::*;

use crate::constants::{
    DEFAULT_FUNDING_INTERVAL_SLOTS, DEFAULT_LIQUIDATION_FEE_BPS, DEFAULT_MAINTENANCE_MARGIN_BPS,
    DEFAULT_MAX_FUNDING_RATE_BPS, DEFAULT_MAX_OPEN_INTEREST, DEFAULT_MAX_SKEW_BPS,
    DEFAULT_ORACLE_MAX_AGE_SECONDS, DEFAULT_ORACLE_MAX_CONFIDENCE_BPS, DEFAULT_TRADING_FEE_BPS,
    MAX_LEVERAGE,
};
use crate::errors::ReputexError;
use crate::events::MarketInitialized;
use crate::state::{Market, Protocol};

#[derive(Accounts)]
#[instruction(market_index: u64)]
pub struct InitializeMarket<'info> {
    #[account(
        mut,
        seeds = [b"protocol"],
        bump = protocol.bump
    )]
    pub protocol: Account<'info, Protocol>,

    #[account(
        init,
        payer = authority,
        space = 8 + Market::INIT_SPACE,
        seeds = [b"market", market_index.to_le_bytes().as_ref()],  
        bump
    )]
    pub market: Account<'info, Market>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeMarket>,
    market_index: u64,
    symbol: String,
    initial_price: u64,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.protocol.authority,
        ReputexError::Unauthorized
    );
    require!(initial_price > 0, ReputexError::InvalidPrice);

    let market = &mut ctx.accounts.market;
    let protocol = &mut ctx.accounts.protocol;
    let current_slot = Clock::get()?.slot;

    market.authority = ctx.accounts.authority.key();
    market.market_index = market_index;
    market.symbol = symbol;
    market.price = initial_price;
    market.max_leverage = MAX_LEVERAGE;
    market.maintenance_margin_bps = DEFAULT_MAINTENANCE_MARGIN_BPS;
    market.liquidation_fee_bps = DEFAULT_LIQUIDATION_FEE_BPS;
    market.trading_fee_bps = DEFAULT_TRADING_FEE_BPS;
    market.max_open_interest = DEFAULT_MAX_OPEN_INTEREST;
    market.max_skew_bps = DEFAULT_MAX_SKEW_BPS;
    market.max_funding_rate_bps = DEFAULT_MAX_FUNDING_RATE_BPS;
    market.funding_interval_slots = DEFAULT_FUNDING_INTERVAL_SLOTS;
    market.last_funding_slot = current_slot;
    market.last_price_update_slot = current_slot;
    market.cumulative_funding_rate_bps = 0;
    market.total_long_size = 0;
    market.total_short_size = 0;
    market.oracle_feed_id = [0; 32];
    market.oracle_max_age_seconds = DEFAULT_ORACLE_MAX_AGE_SECONDS;
    market.oracle_max_confidence_bps = DEFAULT_ORACLE_MAX_CONFIDENCE_BPS;
    market.price_decimals = 0;
    market.oracle_enabled = false;
    market.bump = ctx.bumps.market;

    protocol.total_markets = protocol.total_markets.saturating_add(1);

    emit!(MarketInitialized {
        market_index,
        price: initial_price,
        max_leverage: MAX_LEVERAGE,
    });

    Ok(())
}
