# ReputeX Troubleshooting

## Frontend Will Not Start

Run:

```bash
cd "/c/Users/SUMIT PRASAD/Downloads/reputex/ReputeX/frontend"
npm install
npm run dev
```

If the port is busy, Vite will print a different local URL. Open the URL it prints.

## Frontend Build Fails

Run:

```bash
cd "/c/Users/SUMIT PRASAD/Downloads/reputex/ReputeX/frontend"
npm run build
```

If dependencies are missing:

```bash
npm install
```

## Anchor Is Not Found

Check:

```bash
anchor --version
```

Install Anchor 0.32.1 or add it to PATH. The full program integration tests require Anchor.

## Solana CLI Is Not Found

On this repo, try:

```bash
export PATH="/c/Users/SUMIT PRASAD/Downloads/reputex/ReputeX/tools/solana-release/bin:$PATH"
solana --version
```

## `anchor test` Fails

Try:

```bash
cd "/c/Users/SUMIT PRASAD/Downloads/reputex/ReputeX/program"
npm install
anchor build
anchor test
```

Make sure no other local validator is already using the same ports.

## Phantom Does Not Connect

- Install Phantom.
- Set Phantom to Devnet.
- Refresh the frontend.
- Click `Connect Phantom` again.

## Program Does Not Load in Live Devnet

Check:

- Program id in `frontend/src/config/markets.js`
- Program id in `program/Anchor.toml`
- Program id in `declare_id!` in `program/programs/reputex/src/lib.rs`
- Fresh IDL exists at `frontend/public/idl/reputex.json`

Copy the IDL again:

```bash
cd "/c/Users/SUMIT PRASAD/Downloads/reputex/ReputeX"
cp program/target/idl/reputex.json frontend/public/idl/reputex.json
```

## Deposit Fails

Common causes:

- Owner token account is missing
- Owner token account has no collateral tokens
- Wrong collateral mint
- Protocol is not bootstrapped

In Live Devnet:

1. `Load Program`
2. `Create Token Account`
3. Mint or transfer test collateral to that token account
4. Retry `Deposit`

## Open Position Fails

Common causes:

- No trader profile
- Insufficient free collateral
- Leverage is above reputation cap
- Price is stale
- Market risk limits reject the order

Try:

1. `Create Profile`
2. `Deposit`
3. `Refresh Pyth`
4. Lower leverage
5. Retry `Open`

## Pyth Price Fails

Common causes:

- Wrong PriceUpdateV2 account
- Stale price update
- Confidence too wide
- Market oracle feed id mismatch

Refresh the price update account and confirm the configured feed id.

## Build Warning About Large Chunks

The frontend uses Solana and Anchor client libraries, which increase the bundle size. This is a warning, not a build failure. Later optimization can split Live Devnet code into a lazy-loaded chunk.
