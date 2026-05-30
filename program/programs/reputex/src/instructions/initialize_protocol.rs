use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{PROTOCOL_SEED, VAULT_SEED};
use crate::state::Protocol;

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Protocol::INIT_SPACE,
        seeds = [PROTOCOL_SEED],
        bump
    )]
    pub protocol: Account<'info, Protocol>,

    pub collateral_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        token::mint = collateral_mint,
        token::authority = protocol,
        seeds = [VAULT_SEED],
        bump
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeProtocol>) -> Result<()> {
    let protocol = &mut ctx.accounts.protocol;

    protocol.authority = ctx.accounts.authority.key();
    protocol.collateral_mint = ctx.accounts.collateral_mint.key();
    protocol.collateral_vault = ctx.accounts.collateral_vault.key();
    protocol.total_traders = 0;
    protocol.total_markets = 0;
    protocol.next_position_id = 0;
    protocol.bump = ctx.bumps.protocol;
    protocol.vault_bump = ctx.bumps.collateral_vault;

    Ok(())
}
