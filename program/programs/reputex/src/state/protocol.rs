use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Protocol {
    pub authority: Pubkey,
    pub collateral_mint: Pubkey,
    pub collateral_vault: Pubkey,
    pub insurance_fund_balance: u64,
    pub total_bad_debt: u64,
    pub total_fees_collected: u64,
    pub total_traders: u64,
    pub total_markets: u64,
    pub next_position_id: u64,
    pub trading_paused: bool,
    pub bump: u8,
    pub vault_bump: u8,
}
