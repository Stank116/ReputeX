use anchor_lang::prelude::*;

use crate::constants::PROTOCOL_SEED;
use crate::errors::ReputexError;
use crate::events::ProtocolPaused;
use crate::state::Protocol;

#[derive(Accounts)]
pub struct SetProtocolPaused<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump
    )]
    pub protocol: Account<'info, Protocol>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<SetProtocolPaused>, trading_paused: bool) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.protocol.authority,
        ReputexError::Unauthorized
    );

    ctx.accounts.protocol.trading_paused = trading_paused;

    emit!(ProtocolPaused {
        authority: ctx.accounts.authority.key(),
        trading_paused,
    });

    Ok(())
}
