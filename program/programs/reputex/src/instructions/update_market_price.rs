use anchor_lang::prelude::*;

use crate::errors::ReputexError;
use crate::events::MarketPriceUpdated;
use crate::state::{Market, Protocol};

#[derive(Accounts)]
#[instruction(market_index: u64)]
pub struct UpdateMarketPrice<'info> {
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

pub fn handler(ctx: Context<UpdateMarketPrice>, _market_index: u64, new_price: u64) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.protocol.authority,
        ReputexError::Unauthorized
    );
    require!(new_price > 0, ReputexError::InvalidPrice);
    require!(
        !ctx.accounts.market.oracle_enabled,
        ReputexError::ManualPriceUpdateDisabled
    );

    let old_price = ctx.accounts.market.price;
    let slot = Clock::get()?.slot;
    ctx.accounts.market.price = new_price;
    ctx.accounts.market.last_price_update_slot = slot;

    emit!(MarketPriceUpdated {
        market_index: ctx.accounts.market.market_index,
        old_price,
        new_price,
        slot,
    });

    Ok(())
}
