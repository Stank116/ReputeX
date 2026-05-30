use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct TraderProfile {
    pub owner: Pubkey,
    pub total_trades: u64,
    pub winning_trades: u64,
    pub losing_trades: u64,
    pub liquidations: u64,
    pub total_volume: u64,
    pub realized_pnl: i64,
    pub avg_leverage_x100: u64,
    pub reputation_score: u64,
    pub bump: u8,
}
