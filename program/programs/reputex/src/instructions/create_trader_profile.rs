use anchor_lang::prelude::*;

use crate::constants::STARTING_REPUTATION_SCORE;
use crate::state::{MarginAccount, Protocol, TraderProfile};

#[derive(Accounts)]
pub struct CreateTraderProfile<'info> {
    #[account(
        mut,
        seeds = [b"protocol"],
        bump = protocol.bump
    )]
    pub protocol: Account<'info, Protocol>,

    #[account(
        init,
        payer = owner,
        space = 8 + TraderProfile::INIT_SPACE,
        seeds = [b"trader", owner.key().as_ref()],
        bump
    )]
    pub trader_profile: Account<'info, TraderProfile>,

    #[account(
        init,
        payer = owner,
        space = 8 + MarginAccount::INIT_SPACE,
        seeds = [b"margin", owner.key().as_ref()],
        bump
    )]
    pub margin_account: Account<'info, MarginAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateTraderProfile>) -> Result<()> {
    let profile = &mut ctx.accounts.trader_profile;
    let margin = &mut ctx.accounts.margin_account;
    let protocol = &mut ctx.accounts.protocol;

    profile.owner = ctx.accounts.owner.key();
    profile.total_trades = 0;
    profile.winning_trades = 0;
    profile.losing_trades = 0;
    profile.liquidations = 0;
    profile.total_volume = 0;
    profile.realized_pnl = 0;
    profile.avg_leverage_x100 = 0;
    profile.reputation_score = STARTING_REPUTATION_SCORE;
    profile.bump = ctx.bumps.trader_profile;

    margin.owner = ctx.accounts.owner.key();
    margin.collateral_balance = 0;
    margin.locked_collateral = 0;
    margin.bump = ctx.bumps.margin_account;

    protocol.total_traders = protocol.total_traders.saturating_add(1);

    Ok(())
}
