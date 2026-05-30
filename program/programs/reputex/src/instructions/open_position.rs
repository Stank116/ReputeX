use anchor_lang::prelude::*;

use crate::constants::{BASIS_POINTS, MIN_LEVERAGE};
use crate::errors::ReputexError;
use crate::state::{MarginAccount, Market, Position, Protocol, TraderProfile};
use crate::utils::{calculate_position_size, max_leverage_for_reputation};

#[derive(Accounts)]
#[instruction(position_id: u64, market_index: u64)]
pub struct OpenPosition<'info> {
    #[account(
        mut,
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

    #[account(
        mut,
        seeds = [b"trader", owner.key().as_ref()],
        bump = trader_profile.bump
    )]
    pub trader_profile: Account<'info, TraderProfile>,

    #[account(
        mut,
        seeds = [b"margin", owner.key().as_ref()],
        bump = margin_account.bump
    )]
    pub margin_account: Account<'info, MarginAccount>,

    #[account(
        init,
        payer = owner,
        space = 8 + Position::INIT_SPACE,
        seeds = [b"position", owner.key().as_ref(), &position_id.to_le_bytes()],
        bump
    )]
    pub position: Account<'info, Position>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<OpenPosition>,
    position_id: u64,
    market_index: u64,
    is_long: bool,
    collateral_amount: u64,
    leverage: u8,
) -> Result<()> {
    let protocol = &mut ctx.accounts.protocol;
    let market = &mut ctx.accounts.market;
    let profile = &mut ctx.accounts.trader_profile;
    let margin = &mut ctx.accounts.margin_account;
    let position = &mut ctx.accounts.position;
    let max_allowed_leverage =
        max_leverage_for_reputation(profile.reputation_score, market.max_leverage);

    require!(
        position_id == protocol.next_position_id,
        ReputexError::InvalidPositionId
    );
    require!(collateral_amount > 0, ReputexError::InvalidAmount);
    require!(
        leverage >= MIN_LEVERAGE && leverage <= max_allowed_leverage,
        ReputexError::InvalidLeverage
    );

    let size = calculate_position_size(collateral_amount, leverage)?;

    require!(
        market
            .total_long_size
            .checked_add(market.total_short_size)
            .and_then(|open_interest| open_interest.checked_add(size))
            .ok_or(error!(ReputexError::MathOverflow))?
            <= market.max_open_interest,
        ReputexError::OpenInterestLimitExceeded
    );

    let trading_fee = size
        .checked_mul(market.trading_fee_bps)
        .ok_or(error!(ReputexError::MathOverflow))?
        .checked_div(BASIS_POINTS)
        .ok_or(error!(ReputexError::MathOverflow))?;
    let required_free_collateral = collateral_amount
        .checked_add(trading_fee)
        .ok_or(error!(ReputexError::MathOverflow))?;

    require!(
        margin.free_collateral() >= required_free_collateral,
        ReputexError::InsufficientFreeCollateral
    );

    margin.locked_collateral = margin
        .locked_collateral
        .checked_add(collateral_amount)
        .ok_or(error!(ReputexError::MathOverflow))?;
    margin.collateral_balance = margin
        .collateral_balance
        .checked_sub(trading_fee)
        .ok_or(error!(ReputexError::MathOverflow))?;
    protocol.insurance_fund_balance = protocol
        .insurance_fund_balance
        .checked_add(trading_fee)
        .ok_or(error!(ReputexError::MathOverflow))?;
    protocol.total_fees_collected = protocol
        .total_fees_collected
        .checked_add(trading_fee)
        .ok_or(error!(ReputexError::MathOverflow))?;

    if is_long {
        market.total_long_size = market
            .total_long_size
            .checked_add(size)
            .ok_or(error!(ReputexError::MathOverflow))?;
    } else {
        market.total_short_size = market
            .total_short_size
            .checked_add(size)
            .ok_or(error!(ReputexError::MathOverflow))?;
    }

    position.owner = ctx.accounts.owner.key();
    position.position_id = position_id;
    position.market_index = market_index;
    position.is_long = is_long;
    position.collateral_amount = collateral_amount;
    position.leverage = leverage;
    position.entry_price = market.price;
    position.entry_funding_rate_bps = market.cumulative_funding_rate_bps;
    position.size = size;
    position.is_open = true;
    position.bump = ctx.bumps.position;

    protocol.next_position_id = protocol.next_position_id.saturating_add(1);

    Ok(())
}
