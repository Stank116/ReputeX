use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::constants::{BASIS_POINTS, MARKET_SEED, PROTOCOL_SEED};
use crate::errors::ReputexError;
use crate::events::MarketPriceUpdated;
use crate::state::{Market, Protocol};
use crate::utils::normalize_oracle_price;

#[derive(Accounts)]
#[instruction(market_index: u64)]
pub struct UpdateMarketPriceFromPyth<'info> {
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

    pub price_update: Account<'info, PriceUpdateV2>,
}

pub fn handler(ctx: Context<UpdateMarketPriceFromPyth>, _market_index: u64) -> Result<()> {
    let market = &mut ctx.accounts.market;
    require!(market.oracle_enabled, ReputexError::OracleNotConfigured);
    require!(
        market.oracle_feed_id != [0; 32],
        ReputexError::OracleNotConfigured
    );

    let clock = Clock::get()?;
    let price = ctx.accounts.price_update.get_price_no_older_than(
        &clock,
        market.oracle_max_age_seconds,
        &market.oracle_feed_id,
    )?;
    require!(price.price > 0, ReputexError::InvalidOraclePrice);

    let confidence_bps = (price.conf as u128)
        .checked_mul(BASIS_POINTS as u128)
        .ok_or(error!(ReputexError::MathOverflow))?
        .checked_div(price.price as u128)
        .ok_or(error!(ReputexError::MathOverflow))?;
    require!(
        confidence_bps <= market.oracle_max_confidence_bps as u128,
        ReputexError::OracleConfidenceTooWide
    );

    let old_price = market.price;
    let new_price = normalize_oracle_price(price.price, price.exponent, market.price_decimals)?;
    require!(new_price > 0, ReputexError::InvalidOraclePrice);

    market.price = new_price;
    market.last_price_update_slot = clock.slot;

    emit!(MarketPriceUpdated {
        market_index: market.market_index,
        old_price,
        new_price,
        slot: clock.slot,
    });

    Ok(())
}
