# ReputeX Deployment Runbook

This program is suitable for local and devnet testing after the Anchor test suite
passes. It is not ready for mainnet user funds until the oracle, frontend,
security review, and operational controls below are completed.

## Current On-Chain Controls

- SPL collateral is custodied in a protocol vault PDA.
- Trading fees are deducted on open and credited to the insurance fund.
- Positive trader PnL is paid from the insurance fund.
- Liquidation rewards are paid from the collateral vault.
- New position opens can be paused by the protocol authority.
- Market risk parameters are configurable per market:
  - max open interest
  - max long/short skew
  - max funding rate movement
  - funding interval in slots
- Funding can be advanced by a permissionless crank from market skew.
- Program events are emitted for deposits, withdrawals, price updates, funding,
  risk changes, opens, closes, liquidations, and pause changes.

## Devnet Deployment

```bash
cd program
yarn install
anchor test
solana config set --url devnet
anchor build
anchor deploy --provider.cluster devnet
```

After deploy, update the program id in:

- `program/programs/reputex/src/lib.rs`
- `program/Anchor.toml`

Then rebuild and verify:

```bash
anchor build
solana program show <PROGRAM_ID> --url devnet
```

Bootstrap the protocol, market, and optional Pyth oracle config:

```bash
COLLATERAL_MINT=<SPL_MINT> \
MARKET_INDEX=0 \
MARKET_SYMBOL=SOL-PERP \
INITIAL_PRICE=100000000 \
PYTH_FEED_ID=<32_BYTE_HEX_FEED_ID> \
PRICE_DECIMALS=6 \
npm run bootstrap:devnet
```

Run the funding keeper once:

```bash
MARKET_INDICES=0 npm run keeper:funding
```

Run the keeper continuously:

```bash
MARKET_INDICES=0 KEEPER_INTERVAL_MS=30000 RUN_FOREVER=true npm run keeper:funding
```

Serve the repo root and open the live devnet console after `anchor build`
generates a fresh IDL:

```bash
cd ..
python -m http.server 8080
```

Then open `http://localhost:8080/frontend/live-devnet.html`.

## Mainnet Blockers

Do not accept real user deposits until these are done:

- Build and test production artifacts with the `pyth` feature enabled.
- Configure one Pyth feed id per market with `configure_market_oracle`.
- Validate every Pyth path on devnet with stale-price and wide-confidence failures.
- Submit fresh oracle updates in frontend transactions before trading.
- Build the real wallet frontend with Anchor client calls and token account
  handling. The included `frontend/` is still a local simulator.
- Use a multisig as protocol authority.
- Decide and document upgrade authority policy.
- Run a professional security audit and remediate findings.
- Run stress tests for skew, insurance fund depletion, funding spikes, and bad
  debt.
- Deploy monitoring for every emitted event and critical account balance.

## Authority Policy

For devnet, a single authority wallet is acceptable.

For mainnet, use a multisig for:

- market creation
- market risk configuration
- emergency pause
- upgrade authority
- any temporary admin oracle path that remains before full oracle integration

Keep the upgrade authority separate from day-to-day operational wallets.

## Emergency Procedure

1. Call `set_protocol_paused(true)` to block new position opens.
2. Keep close, withdraw, and liquidation paths available so users and keepers can
   reduce risk.
3. Publish the incident reason and expected next action.
4. Resume with `set_protocol_paused(false)` only after the issue is fixed and
   verified on a fork/local validator.
