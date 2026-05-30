use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct MarginAccount {
    pub owner: Pubkey,
    pub collateral_balance: u64,
    pub locked_collateral: u64,
    pub bump: u8,
}

impl MarginAccount {
    pub fn free_collateral(&self) -> u64 {
        self.collateral_balance
            .saturating_sub(self.locked_collateral)
    }
}
