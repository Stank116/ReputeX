use anchor_lang::prelude::*;

#[event]
pub struct ProtocolInitialized {
    pub authority: Pubkey,
    pub collateral_mint: Pubkey,
    pub collateral_vault: Pubkey,
}

#[event]
pub struct ProtocolPaused {
    pub authority: Pubkey,
    pub trading_paused: bool,
}

#[event]
pub struct MarketInitialized {
    pub market_index: u64,
    pub price: u64,
    pub max_leverage: u8,
}

#[event]
pub struct MarketRiskConfigured {
    pub market_index: u64,
    pub max_open_interest: u64,
    pub max_skew_bps: u64,
    pub max_funding_rate_bps: u64,
    pub funding_interval_slots: u64,
}

#[event]
pub struct MarketOracleConfigured {
    pub market_index: u64,
    pub oracle_feed_id: [u8; 32],
    pub oracle_max_age_seconds: u64,
    pub oracle_max_confidence_bps: u64,
    pub price_decimals: u8,
    pub oracle_enabled: bool,
}

#[event]
pub struct MarketPriceUpdated {
    pub market_index: u64,
    pub old_price: u64,
    pub new_price: u64,
    pub slot: u64,
}

#[event]
pub struct FundingRateUpdated {
    pub market_index: u64,
    pub funding_delta_bps: i64,
    pub cumulative_funding_rate_bps: i64,
    pub slot: u64,
}

#[event]
pub struct FundingSettled {
    pub market_index: u64,
    pub funding_delta_bps: i64,
    pub cumulative_funding_rate_bps: i64,
    pub long_open_interest: u64,
    pub short_open_interest: u64,
    pub slot: u64,
}

#[event]
pub struct CollateralDeposited {
    pub owner: Pubkey,
    pub amount: u64,
    pub margin_balance: u64,
}

#[event]
pub struct CollateralWithdrawn {
    pub owner: Pubkey,
    pub amount: u64,
    pub margin_balance: u64,
}

#[event]
pub struct InsuranceFunded {
    pub funder: Pubkey,
    pub amount: u64,
    pub insurance_fund_balance: u64,
}

#[event]
pub struct PositionOpened {
    pub owner: Pubkey,
    pub position_id: u64,
    pub market_index: u64,
    pub is_long: bool,
    pub collateral_amount: u64,
    pub size: u64,
    pub leverage: u8,
    pub entry_price: u64,
    pub trading_fee: u64,
}

#[event]
pub struct PositionClosed {
    pub owner: Pubkey,
    pub position_id: u64,
    pub market_index: u64,
    pub price_pnl: i64,
    pub funding_pnl: i64,
    pub realized_pnl: i64,
    pub bad_debt: u64,
    pub margin_balance: u64,
}

#[event]
pub struct PositionLiquidated {
    pub owner: Pubkey,
    pub liquidator: Pubkey,
    pub position_id: u64,
    pub market_index: u64,
    pub realized_pnl: i64,
    pub liquidation_reward: u64,
    pub bad_debt: u64,
    pub insurance_fund_balance: u64,
}
