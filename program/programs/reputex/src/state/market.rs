use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub authority: Pubkey,
    pub market_index: u64,
    #[max_len(16)]
    pub symbol: String,
    pub price: u64,
    pub max_leverage: u8,
    pub maintenance_margin_bps: u64,
    pub liquidation_fee_bps: u64,
    pub total_long_size: u64,
    pub total_short_size: u64,
    pub bump: u8,
}
