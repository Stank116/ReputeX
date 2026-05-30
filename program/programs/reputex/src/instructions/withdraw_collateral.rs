use anchor_lang::prelude::*;

use crate::errors::ReputexError;
use crate::state::MarginAccount;

#[derive(Accounts)]
pub struct WithdrawCollateral<'info> {
    #[account(
        mut,
        seeds = [b"margin", owner.key().as_ref()],
        bump = margin_account.bump
    )]
    pub margin_account: Account<'info, MarginAccount>,

    pub owner: Signer<'info>,
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

    Ok(())
}
