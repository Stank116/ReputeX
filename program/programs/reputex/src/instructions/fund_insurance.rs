use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::PROTOCOL_SEED;
use crate::errors::ReputexError;
use crate::events::InsuranceFunded;
use crate::state::Protocol;

#[derive(Accounts)]
pub struct FundInsurance<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump
    )]
    pub protocol: Account<'info, Protocol>,

    #[account(
        mut,
        address = protocol.collateral_vault @ ReputexError::InvalidCollateralVault
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = funder_token_account.mint == protocol.collateral_mint @ ReputexError::InvalidCollateralMint,
        constraint = funder_token_account.owner == funder.key() @ ReputexError::InvalidTokenAccountOwner
    )]
    pub funder_token_account: Account<'info, TokenAccount>,

    pub funder: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<FundInsurance>, amount: u64) -> Result<()> {
    require!(amount > 0, ReputexError::InvalidAmount);

    let cpi_accounts = Transfer {
        from: ctx.accounts.funder_token_account.to_account_info(),
        to: ctx.accounts.collateral_vault.to_account_info(),
        authority: ctx.accounts.funder.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    ctx.accounts.protocol.insurance_fund_balance = ctx
        .accounts
        .protocol
        .insurance_fund_balance
        .checked_add(amount)
        .ok_or(error!(ReputexError::MathOverflow))?;

    emit!(InsuranceFunded {
        funder: ctx.accounts.funder.key(),
        amount,
        insurance_fund_balance: ctx.accounts.protocol.insurance_fund_balance,
    });

    Ok(())
}
