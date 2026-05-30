#![allow(ambiguous_glob_reexports)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

pub use instructions::*;

declare_id!("EcKorS8y9kXHXQDjzN9eBYuhKqtdDFhypD9ceYfFKpfH");

#[program]
pub mod reputex {
    use super::*;

    pub fn initialize_protocol(ctx: Context<InitializeProtocol>) -> Result<()> {
        initialize_protocol::handler(ctx)
    }

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        market_index: u64,
        symbol: String,
        initial_price: u64,
    ) -> Result<()> {
        initialize_market::handler(ctx, market_index, symbol, initial_price)
    }

    pub fn create_trader_profile(ctx: Context<CreateTraderProfile>) -> Result<()> {
        create_trader_profile::handler(ctx)
    }

    pub fn deposit_collateral(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
        deposit_collateral::handler(ctx, amount)
    }

    pub fn fund_insurance(ctx: Context<FundInsurance>, amount: u64) -> Result<()> {
        fund_insurance::handler(ctx, amount)
    }

    pub fn withdraw_collateral(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
        withdraw_collateral::handler(ctx, amount)
    }

    pub fn update_market_price(
        ctx: Context<UpdateMarketPrice>,
        market_index: u64,
        new_price: u64,
    ) -> Result<()> {
        update_market_price::handler(ctx, market_index, new_price)
    }

    pub fn update_funding_rate(
        ctx: Context<UpdateFundingRate>,
        market_index: u64,
        funding_delta_bps: i64,
    ) -> Result<()> {
        update_funding_rate::handler(ctx, market_index, funding_delta_bps)
    }

    pub fn settle_funding(ctx: Context<SettleFunding>, market_index: u64) -> Result<()> {
        settle_funding::handler(ctx, market_index)
    }

    pub fn configure_market_risk(
        ctx: Context<ConfigureMarketRisk>,
        market_index: u64,
        max_open_interest: u64,
        max_skew_bps: u64,
        max_funding_rate_bps: u64,
        funding_interval_slots: u64,
    ) -> Result<()> {
        configure_market_risk::handler(
            ctx,
            market_index,
            max_open_interest,
            max_skew_bps,
            max_funding_rate_bps,
            funding_interval_slots,
        )
    }

    pub fn configure_market_oracle(
        ctx: Context<ConfigureMarketOracle>,
        market_index: u64,
        oracle_feed_id: [u8; 32],
        oracle_max_age_seconds: u64,
        oracle_max_confidence_bps: u64,
        price_decimals: u8,
        oracle_enabled: bool,
    ) -> Result<()> {
        configure_market_oracle::handler(
            ctx,
            market_index,
            oracle_feed_id,
            oracle_max_age_seconds,
            oracle_max_confidence_bps,
            price_decimals,
            oracle_enabled,
        )
    }

    pub fn set_protocol_paused(ctx: Context<SetProtocolPaused>, trading_paused: bool) -> Result<()> {
        set_protocol_paused::handler(ctx, trading_paused)
    }

    pub fn open_position(
        ctx: Context<OpenPosition>,
        position_id: u64,
        market_index: u64,
        is_long: bool,
        collateral_amount: u64,
        leverage: u8,
    ) -> Result<()> {
        open_position::handler(
            ctx,
            position_id,
            market_index,
            is_long,
            collateral_amount,
            leverage,
        )
    }

    pub fn close_position(
        ctx: Context<ClosePosition>,
        position_id: u64,
        market_index: u64,
    ) -> Result<()> {
        close_position::handler(ctx, position_id, market_index)
    }

    pub fn liquidate_position(
        ctx: Context<LiquidatePosition>,
        position_id: u64,
        market_index: u64,
    ) -> Result<()> {
        liquidate_position::handler(ctx, position_id, market_index)
    }
}
