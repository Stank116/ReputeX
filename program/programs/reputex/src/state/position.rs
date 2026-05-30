use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub position_id: u64,
    pub market_index: u64,
    pub is_long: bool,
    pub collateral_amount: u64,
    pub leverage: u8,
    pub entry_price: u64,
    pub size: u64,
    pub is_open: bool,
    pub bump: u8,
}
