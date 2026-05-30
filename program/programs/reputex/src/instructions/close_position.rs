use anchor_lang::prelude::*;

use crate::errors::ReputexError;
use crate::events::PositionClosed;
use crate::state::{MarginAccount, Market, Position, Protocol, TraderProfile};
use crate::utils::{
    calculate_funding_pnl, calculate_pnl, reputation_score, require_fresh_market_price,
};

#[derive(Accounts)]
#[instruction(position_id: u64, market_index: u64)]
pub struct ClosePosition<'info> {
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
        mut,
        seeds = [b"position", owner.key().as_ref(), &position_id.to_le_bytes()],
        bump = position.bump
    )]
    pub position: Account<'info, Position>,

    pub owner: Signer<'info>,
}

pub fn handler(ctx: Context<ClosePosition>, _position_id: u64, _market_index: u64) -> Result<()> {
    let protocol = &mut ctx.accounts.protocol;
    let market = &mut ctx.accounts.market;
    let profile = &mut ctx.accounts.trader_profile;
    let margin = &mut ctx.accounts.margin_account;
    let position = &mut ctx.accounts.position;

    require!(position.is_open, ReputexError::PositionClosed);
    require_fresh_market_price(market.last_price_update_slot, Clock::get()?.slot)?;

    let price_pnl = calculate_pnl(
        position.is_long,
        position.size,
        position.entry_price,
        market.price,
    )?;
    let funding_pnl = calculate_funding_pnl(
        position.is_long,
        position.size,
        position.entry_funding_rate_bps,
        market.cumulative_funding_rate_bps,
    )?;
    let pnl = price_pnl
        .checked_add(funding_pnl)
        .ok_or(error!(ReputexError::MathOverflow))?;

    // Unlock collateral first
    margin.locked_collateral = margin
        .locked_collateral
        .checked_sub(position.collateral_amount)
        .ok_or(error!(ReputexError::MathOverflow))?;

    // Apply PnL to balance
    let mut bad_debt = 0;
    if pnl >= 0 {
        require!(
            protocol.insurance_fund_balance >= pnl as u64,
            ReputexError::InsufficientInsuranceFund
        );
        protocol.insurance_fund_balance = protocol
            .insurance_fund_balance
            .checked_sub(pnl as u64)
            .ok_or(error!(ReputexError::MathOverflow))?;
        margin.collateral_balance = margin
            .collateral_balance
            .checked_add(pnl as u64)
            .ok_or(error!(ReputexError::MathOverflow))?;
        profile.winning_trades = profile.winning_trades.saturating_add(1);
    } else {
        // Losses can only credit insurance with collateral that exists in the trader's margin balance.
        let loss = pnl.unsigned_abs();
        let collectible_loss = loss.min(margin.collateral_balance);
        bad_debt = loss.saturating_sub(collectible_loss);
        margin.collateral_balance = margin
            .collateral_balance
            .checked_sub(collectible_loss)
            .ok_or(error!(ReputexError::MathOverflow))?;
        protocol.insurance_fund_balance = protocol
            .insurance_fund_balance
            .checked_add(collectible_loss)
            .ok_or(error!(ReputexError::MathOverflow))?;
        protocol.total_bad_debt = protocol
            .total_bad_debt
            .checked_add(bad_debt)
            .ok_or(error!(ReputexError::MathOverflow))?;
        profile.losing_trades = profile.losing_trades.saturating_add(1);
    }

    // Update open interest
    if position.is_long {
        market.total_long_size = market.total_long_size.saturating_sub(position.size);
    } else {
        market.total_short_size = market.total_short_size.saturating_sub(position.size);
    }

    // Update profile stats
    let previous_trades = profile.total_trades;
    profile.total_trades = profile.total_trades.saturating_add(1);
    profile.total_volume = profile.total_volume.saturating_add(position.size);
    profile.realized_pnl = profile.realized_pnl.saturating_add(pnl);

    // Running average leverage: new_avg = (old_avg * old_count + new_value) / new_count
    let new_leverage_x100 = position.leverage as u64 * 100;
    profile.avg_leverage_x100 = if previous_trades == 0 {
        new_leverage_x100
    } else {
        profile
            .avg_leverage_x100
            .saturating_mul(previous_trades)
            .saturating_add(new_leverage_x100)
            .checked_div(profile.total_trades)
            .unwrap_or(new_leverage_x100)
    };

    profile.reputation_score = reputation_score(
        profile.total_trades,
        profile.winning_trades,
        profile.liquidations,
        profile.realized_pnl,
        profile.total_volume,
        profile.avg_leverage_x100,
    );

    position.is_open = false;

    emit!(PositionClosed {
        owner: ctx.accounts.owner.key(),
        position_id: position.position_id,
        market_index: position.market_index,
        price_pnl,
        funding_pnl,
        realized_pnl: pnl,
        bad_debt,
        margin_balance: margin.collateral_balance,
    });

    Ok(())
}
