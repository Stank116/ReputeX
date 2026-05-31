# ReputeX Trader Guide

This guide explains how to use the ReputeX frontend.

## Demo Terminal

The `Terminal` tab is a local simulator. It does not use real funds.

1. Open the frontend.
2. Select the `Terminal` tab.
3. Click `Connect`.
4. Enter a collateral amount in the portfolio controls.
5. Click `Deposit`.
6. Pick a market.
7. Choose `Market`, `Limit`, or `Stop`.
8. Choose `Long` or `Short`.
9. Set collateral and leverage.
10. Open or place the order.

## Order Types

- `Market`: Opens immediately at the current simulated mark price.
- `Limit`: Long limits must be below mark. Short limits must be above mark.
- `Stop`: Long stops must be above mark. Short stops must be below mark.

Pending orders reserve collateral. Cancel a pending order to release the reserved amount.

## Position Management

Open positions appear in the portfolio table.

- `Add`: Adds margin and lowers effective leverage.
- `Reduce`: Partially closes 25%, 50%, or 75%.
- `Close`: Fully closes the position.

## Risk Fields

- `Health`: Equity divided by maintenance margin.
- `Liq. gap`: Percent distance between current mark and liquidation price.
- `Margin used`: Locked collateral divided by account equity.
- `Reserved`: Collateral reserved by pending conditional orders.

## Live Devnet

The `Live Devnet` tab sends real devnet transactions through Phantom.

Before using it:

1. Set Phantom to Devnet.
2. Make sure the program is deployed and bootstrapped.
3. Make sure `frontend/public/idl/reputex.json` is fresh.
4. Load the app and open `Live Devnet`.

Recommended first flow:

1. `Connect Phantom`
2. `Load Program`
3. `Create Token Account`
4. `Create Profile`
5. `Deposit`
6. `Refresh Pyth`
7. `Open`
8. `Close`

If `Deposit` fails, confirm your owner token account exists and has the devnet collateral token.

## Safety

Use devnet only unless the program has been audited and the deployment has production monitoring. Devnet tokens have no real value.
