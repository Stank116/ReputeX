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
    pub trading_fee_bps: u64,
    pub max_open_interest: u64,
    pub max_skew_bps: u64,
    pub max_funding_rate_bps: u64,
    pub funding_interval_slots: u64,
    pub last_funding_slot: u64,
    pub last_price_update_slot: u64,
    pub cumulative_funding_rate_bps: i64,
    pub total_long_size: u64,
    pub total_short_size: u64,
    pub oracle_feed_id: [u8; 32],
    pub oracle_max_age_seconds: u64,
    pub oracle_max_confidence_bps: u64,
    pub price_decimals: u8,
    pub oracle_enabled: bool,
    pub bump: u8,
}
