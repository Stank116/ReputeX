use anchor_lang::prelude::*;

use crate::errors::ReputexError;
use crate::state::MarginAccount;

#[derive(Accounts)]
pub struct DepositCollateral<'info> {
    #[account(
        mut,
        seeds = [b"margin", owner.key().as_ref()],
        bump = margin_account.bump
    )]
    pub margin_account: Account<'info, MarginAccount>,

    pub owner: Signer<'info>,
}

pub fn handler(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, ReputexError::InvalidAmount);

    let margin = &mut ctx.accounts.margin_account;
    margin.collateral_balance = margin
        .collateral_balance
        .checked_add(amount)
        .ok_or(error!(ReputexError::MathOverflow))?;

    Ok(())
}
