use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{MARGIN_SEED, PROTOCOL_SEED};
use crate::errors::ReputexError;
use crate::events::CollateralDeposited;
use crate::state::{MarginAccount, Protocol};

#[derive(Accounts)]
pub struct DepositCollateral<'info> {
    #[account(
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump
    )]
    pub protocol: Account<'info, Protocol>,

    #[account(
        mut,
        seeds = [MARGIN_SEED, owner.key().as_ref()],
        bump = margin_account.bump
    )]
    pub margin_account: Account<'info, MarginAccount>,

    #[account(
        mut,
        address = protocol.collateral_vault @ ReputexError::InvalidCollateralVault
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = owner_token_account.mint == protocol.collateral_mint @ ReputexError::InvalidCollateralMint,
        constraint = owner_token_account.owner == owner.key() @ ReputexError::InvalidTokenAccountOwner
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub owner: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, ReputexError::InvalidAmount);

    let cpi_accounts = Transfer {
        from: ctx.accounts.owner_token_account.to_account_info(),
        to: ctx.accounts.collateral_vault.to_account_info(),
        authority: ctx.accounts.owner.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    let margin = &mut ctx.accounts.margin_account;
    margin.collateral_balance = margin
        .collateral_balance
        .checked_add(amount)
        .ok_or(error!(ReputexError::MathOverflow))?;

    emit!(CollateralDeposited {
        owner: ctx.accounts.owner.key(),
        amount,
        margin_balance: margin.collateral_balance,
    });

    Ok(())
}
