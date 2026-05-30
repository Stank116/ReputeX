use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{BASIS_POINTS, PROTOCOL_SEED};
use crate::errors::ReputexError;
use crate::state::{MarginAccount, Market, Position, Protocol, TraderProfile};
use crate::utils::{calculate_funding_pnl, calculate_pnl, is_liquidatable, reputation_score};

#[derive(Accounts)]
#[instruction(position_id: u64, market_index: u64)]
pub struct LiquidatePosition<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_SEED],
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
        seeds = [b"trader", trader.key().as_ref()],
        bump = trader_profile.bump
    )]
    pub trader_profile: Account<'info, TraderProfile>,

    #[account(
        mut,
        seeds = [b"margin", trader.key().as_ref()],
        bump = margin_account.bump
    )]
    pub margin_account: Account<'info, MarginAccount>,

    #[account(
        mut,
        seeds = [b"position", trader.key().as_ref(), &position_id.to_le_bytes()],
        bump = position.bump
    )]
    pub position: Account<'info, Position>,

    /// CHECK: Used only as a PDA seed for the trader being liquidated.
    pub trader: UncheckedAccount<'info>,

    pub liquidator: Signer<'info>,

    #[account(
        mut,
        address = protocol.collateral_vault @ ReputexError::InvalidCollateralVault
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = liquidator_token_account.mint == protocol.collateral_mint @ ReputexError::InvalidCollateralMint,
        constraint = liquidator_token_account.owner == liquidator.key() @ ReputexError::InvalidTokenAccountOwner
    )]
    pub liquidator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(
    ctx: Context<LiquidatePosition>,
    _position_id: u64,
    _market_index: u64,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let profile = &mut ctx.accounts.trader_profile;
    let margin = &mut ctx.accounts.margin_account;
    let position = &mut ctx.accounts.position;
    let protocol = &mut ctx.accounts.protocol;

    require!(position.is_open, ReputexError::PositionClosed);

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

    require!(
        is_liquidatable(
            position.collateral_amount,
            position.size,
            pnl,
            market.maintenance_margin_bps
        )?,
        ReputexError::PositionNotLiquidatable
    );

    // Unlock and wipe the collateral (trader loses entire collateral on liquidation)
    margin.locked_collateral = margin
        .locked_collateral
        .checked_sub(position.collateral_amount)
        .ok_or(error!(ReputexError::MathOverflow))?;
    margin.collateral_balance = margin
        .collateral_balance
        .saturating_sub(position.collateral_amount);

    let liquidation_reward = position
        .collateral_amount
        .checked_mul(market.liquidation_fee_bps)
        .ok_or(error!(ReputexError::MathOverflow))?
        .checked_div(BASIS_POINTS)
        .ok_or(error!(ReputexError::MathOverflow))?;
    let insurance_remainder = position
        .collateral_amount
        .checked_sub(liquidation_reward)
        .ok_or(error!(ReputexError::MathOverflow))?;
    protocol.insurance_fund_balance = protocol
        .insurance_fund_balance
        .checked_add(insurance_remainder)
        .ok_or(error!(ReputexError::MathOverflow))?;

    if liquidation_reward > 0 {
        let signer_seeds: &[&[&[u8]]] = &[&[PROTOCOL_SEED, &[protocol.bump]]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.collateral_vault.to_account_info(),
            to: ctx.accounts.liquidator_token_account.to_account_info(),
            authority: ctx.accounts.protocol.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, liquidation_reward)?;
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
    profile.losing_trades = profile.losing_trades.saturating_add(1);
    profile.liquidations = profile.liquidations.saturating_add(1);
    profile.total_volume = profile.total_volume.saturating_add(position.size);
    profile.realized_pnl = profile.realized_pnl.saturating_add(pnl);

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

    Ok(())
}
