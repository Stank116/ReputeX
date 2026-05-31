# ReputeX Deployment Guide

This guide deploys ReputeX to Solana devnet and connects the React app to the deployed program.

## Prerequisites

- Node.js 18 or newer
- Rust and Cargo
- Solana CLI
- Anchor CLI 0.32.1
- A devnet wallet with SOL
- Phantom wallet set to Devnet for frontend testing

Check your tools:

```bash
node --version
npm --version
cargo --version
solana --version
anchor --version
```

If `solana` is not on PATH, this repo includes a bundled Windows Solana release:

```bash
export PATH="/c/Users/SUMIT PRASAD/Downloads/reputex/ReputeX/tools/solana-release/bin:$PATH"
solana --version
```

## 1. Install Dependencies

```bash
cd "/c/Users/SUMIT PRASAD/Downloads/reputex/ReputeX/frontend"
npm install

cd "/c/Users/SUMIT PRASAD/Downloads/reputex/ReputeX/program"
npm install
```

## 2. Run Local Verification

```bash
cd "/c/Users/SUMIT PRASAD/Downloads/reputex/ReputeX/frontend"
npm run build
```

```bash
cd "/c/Users/SUMIT PRASAD/Downloads/reputex/ReputeX/program"
cargo test
anchor test
```

`anchor test` is the full local program integration test. It starts a local validator, deploys the program locally, runs tests, and shuts down.

## 3. Configure Devnet

```bash
cd "/c/Users/SUMIT PRASAD/Downloads/reputex/ReputeX/program"
solana config set --url devnet
solana airdrop 2
```

If the faucet is rate limited, use the Solana faucet website and retry:

```bash
solana balance
```

## 4. Build and Deploy Program

```bash
anchor build
anchor deploy --provider.cluster devnet
```

If Anchor prints a new program id, update it in:

- `program/programs/reputex/src/lib.rs`
- `program/Anchor.toml`
- `frontend/src/config/markets.js`

Then rebuild:

```bash
anchor build
```

## 5. Bootstrap Devnet Protocol

This initializes the protocol PDA, collateral mint, vault, and default market.

```bash
npm run bootstrap:devnet
```

Optional oracle configuration:

```bash
PYTH_FEED_ID=<32-byte-hex-feed-id> npm run bootstrap:devnet
```

## 6. Copy Fresh IDL to Frontend

```bash
cd "/c/Users/SUMIT PRASAD/Downloads/reputex/ReputeX"
cp program/target/idl/reputex.json frontend/public/idl/reputex.json
```

## 7. Run Frontend

```bash
cd "/c/Users/SUMIT PRASAD/Downloads/reputex/ReputeX/frontend"
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

Use `Terminal` for local simulation and `Live Devnet` for Phantom/devnet transactions.

## 8. Production Build

```bash
cd "/c/Users/SUMIT PRASAD/Downloads/reputex/ReputeX/frontend"
npm run build
```

The build output is in `frontend/dist`.

## Devnet Launch Checklist

- `npm run build` passes in `frontend`
- `cargo test` passes in `program`
- `anchor test` passes locally
- Program is deployed to devnet
- `npm run bootstrap:devnet` completes
- Fresh IDL copied to `frontend/public/idl/reputex.json`
- Phantom is set to Devnet
- Live Devnet can connect wallet, load program, create token account, create profile, deposit, open, and close

## Mainnet Warning

ReputeX is not mainnet-ready until it has independent smart contract audit, oracle review, admin key custody, keeper monitoring, and incident response runbooks.
