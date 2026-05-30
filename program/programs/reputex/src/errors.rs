use anchor_lang::prelude::*;

#[error_code]
pub enum ReputexError {
    #[msg("Only the protocol authority can perform this action")]
    Unauthorized,

    #[msg("Amount must be greater than zero")]
    InvalidAmount,

    #[msg("Leverage exceeds the trader's reputation tier or market max")]
    InvalidLeverage,

    #[msg("Price must be greater than zero")]
    InvalidPrice,

    #[msg("Insufficient free collateral")]
    InsufficientFreeCollateral,

    #[msg("Invalid collateral mint")]
    InvalidCollateralMint,

    #[msg("Invalid token account owner")]
    InvalidTokenAccountOwner,

    #[msg("Invalid collateral vault")]
    InvalidCollateralVault,

    #[msg("Position id does not match the protocol counter")]
    InvalidPositionId,

    #[msg("Position is already closed")]
    PositionClosed,

    #[msg("Position is not liquidatable; equity is above maintenance margin")]
    PositionNotLiquidatable,

    #[msg("Market open interest limit exceeded")]
    OpenInterestLimitExceeded,

    #[msg("Market skew limit exceeded")]
    SkewLimitExceeded,

    #[msg("Insurance fund cannot cover profitable PnL")]
    InsufficientInsuranceFund,

    #[msg("Protocol trading is paused")]
    ProtocolPaused,

    #[msg("Risk parameter is outside the allowed range")]
    InvalidRiskParameter,

    #[msg("Funding update is too large for this market")]
    FundingRateTooLarge,

    #[msg("Funding interval has not elapsed")]
    FundingNotReady,

    #[msg("Math overflow or underflow")]
    MathOverflow,
}
