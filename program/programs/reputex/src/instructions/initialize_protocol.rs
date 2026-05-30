use anchor_lang::prelude::*;

use crate::state::Protocol;

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Protocol::INIT_SPACE,
        seeds = [b"protocol"],
        bump
    )]
    pub protocol: Account<'info, Protocol>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeProtocol>) -> Result<()> {
    let protocol = &mut ctx.accounts.protocol;

    protocol.authority = ctx.accounts.authority.key();
    protocol.total_traders = 0;
    protocol.total_markets = 0;
    protocol.next_position_id = 0;
    protocol.bump = ctx.bumps.protocol;

    Ok(())
}
