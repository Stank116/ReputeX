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

    #[msg("Math overflow or underflow")]
    MathOverflow,
}
