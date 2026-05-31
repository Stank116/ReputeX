# ReputeX Admin Guide

This guide covers protocol setup and admin operations.

## Admin Authority

The wallet that calls `initialize_protocol` becomes the protocol authority. Keep this key safe.

Admin-only instructions include:

- `initialize_protocol`
- `initialize_market`
- `update_market_price`
- `update_funding_rate`
- `configure_market_risk`
- `configure_market_oracle`
- `set_protocol_paused`
- `fund_insurance`

## Initialize Devnet

```bash
cd "/c/Users/SUMIT PRASAD/Downloads/reputex/ReputeX/program"
solana config set --url devnet
anchor build
anchor deploy --provider.cluster devnet
npm run bootstrap:devnet
```

The bootstrap script creates or reuses:

- Protocol PDA
- Collateral mint
- Collateral vault PDA
- Market PDA

## Configure Pyth Oracle

To enable oracle pricing during bootstrap:

```bash
PYTH_FEED_ID=<32-byte-hex-feed-id> \
ORACLE_MAX_AGE_SECONDS=30 \
ORACLE_MAX_CONFIDENCE_BPS=100 \
PRICE_DECIMALS=6 \
npm run bootstrap:devnet
```

When oracle pricing is enabled, manual market price updates are blocked.

## Fund Insurance

Insurance is used to pay profitable trader PnL.

Use the Live Devnet console or scripts to call `fund_insurance(amount)` from an account with collateral tokens.

## Funding Keeper

Run once:

```bash
npm run keeper:funding
```

Run continuously:

```bash
RUN_FOREVER=true KEEPER_INTERVAL_MS=30000 MARKET_INDICES=0 npm run keeper:funding
```

Production keeper requirements:

- Monitor failed crank attempts
- Alert when funding is not updated
- Run with a funded wallet
- Track market indices explicitly

## Emergency Pause

Use `set_protocol_paused(true)` if trading needs to stop. This blocks new opens while preserving close, withdraw, and liquidation paths.

Unpause with:

```text
set_protocol_paused(false)
```

## Risk Parameters

Use `configure_market_risk` to set:

- Max open interest
- Max skew bps
- Max funding rate bps
- Funding interval slots

Start conservative on devnet and increase limits only after testing.

## Pre-Launch Admin Checklist

- Authority wallet backed up
- Protocol bootstrapped
- Market initialized
- Pyth feed configured
- Insurance fund funded
- Funding keeper running
- Emergency pause tested
- Fresh IDL copied to frontend
- Live Devnet open and close tested
