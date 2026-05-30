use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{MARGIN_SEED, PROTOCOL_SEED};
use crate::errors::ReputexError;
use crate::state::{MarginAccount, Protocol};

#[derive(Accounts)]
pub struct WithdrawCollateral<'info> {
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

pub fn handler(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, ReputexError::InvalidAmount);

    let margin = &mut ctx.accounts.margin_account;
    require!(
        margin.free_collateral() >= amount,
        ReputexError::InsufficientFreeCollateral
    );

    margin.collateral_balance = margin
        .collateral_balance
        .checked_sub(amount)
        .ok_or(error!(ReputexError::MathOverflow))?;

    let signer_seeds: &[&[&[u8]]] = &[&[PROTOCOL_SEED, &[ctx.accounts.protocol.bump]]];
    let cpi_accounts = Transfer {
        from: ctx.accounts.collateral_vault.to_account_info(),
        to: ctx.accounts.owner_token_account.to_account_info(),
        authority: ctx.accounts.protocol.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token::transfer(cpi_ctx, amount)?;

    Ok(())
}
