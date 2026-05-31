# ReputeX

A perpetuals DEX on Solana where your on-chain track record actually earns you something — higher leverage. Every trade you make, every position you close, every time you get liquidated — it all feeds into a reputation score that the protocol enforces at the contract level. No off-chain whitelists, no manual approvals. Just your history.

Built with Anchor 0.32.1 on Solana devnet.

---

## Why this exists

Most perps protocols treat every wallet the same. You show up with fresh keys and you can immediately open a 10x position. ReputeX takes the opposite approach: new wallets start conservative, and you earn leverage over time by not blowing up.

Reputation starts at 100 points when you create a profile. Win trades, it goes up. Build volume, it goes up. Get liquidated, it drops — hard. The protocol reads your score on every `open_position` call and caps your leverage accordingly.

---

## Stack

- **Anchor 0.32.1** — Solana program framework
- **Rust** — on-chain program
- **React 18 + Vite** — frontend trading terminal
- **@coral-xyz/anchor + @solana/web3.js** — client-side program interaction
- **Pyth** — oracle price feeds (devnet/live path)

---

## Repo layout

```
ReputeX/
├── program/                  ← Anchor workspace (the on-chain program)
│   ├── Anchor.toml
│   ├── Cargo.toml
│   ├── programs/reputex/src/
│   │   ├── lib.rs            ← entry point, instruction dispatch
│   │   ├── constants.rs      ← margin ratios, BPS values, PDA seeds
│   │   ├── errors.rs         ← every custom error code
│   │   ├── events.rs         ← on-chain events
│   │   ├── state/            ← Protocol, Market, TraderProfile, MarginAccount, Position
│   │   ├── instructions/     ← one file per instruction
│   │   └── utils/            ← PnL, liquidation, reputation math
│   └── tests/reputex.ts      ← full integration test suite
│
└── frontend/                 ← React trading terminal
    ├── src/
    │   ├── App.jsx
    │   ├── components/
    │   │   ├── trading/      ← TradingTerminal, OrderBook, Portfolio, PriceChart
    │   │   └── live/         ← LiveDevnetConsole for Phantom/devnet transactions
    │   ├── hooks/
    │   │   ├── useLiveTrading.js
    │   │   └── useMarketData.js
    │   ├── lib/
    │   │   ├── perps.js       ← PnL and reputation math (mirrors on-chain)
    │   │   ├── solana.js      ← wallet and RPC helpers
    │   │   └── format.js      ← number formatting
    │   └── config/markets.js  ← program ID and market config
    └── public/idl/            ← generated IDL goes here before running the app
```

---

## Prerequisites

You need these installed before anything else:

- **Node.js 18+**
- **Rust** (stable toolchain)
- **Solana CLI**
- **Anchor CLI 0.32.1**

Quick check:

```bash
node --version
cargo --version
solana --version
anchor --version
```

If you don't have Anchor yet, follow the [official installation guide](https://www.anchor-lang.com/docs/installation). Anchor 0.32.1 specifically — the test suite will break on other versions.

---

## Running the frontend (local simulation)

The frontend has two modes. The **Terminal** tab runs a fully local simulation — no wallet, no devnet, no real tokens. Good for playing with the trading flow without setting up a full Anchor environment.

```bash
cd frontend
npm install
mkdir -p public/idl
cp ../program/target/idl/reputex.json public/idl/reputex.json
npm run dev
```

Then open `http://127.0.0.1:5173`.

> If you haven't built the program yet and don't have an IDL, there's a pre-generated one already at `frontend/public/idl/reputex.json` from the last `anchor build`. You can use that to start the frontend without running a full build.

---

## Running the tests

The test suite needs a full Anchor setup. From the `program/` directory:

```bash
cd program
yarn install
anchor test
```

`anchor test` handles everything — spins up a local validator, deploys the program, runs all 10 tests, and tears it down. First run takes a few minutes because Rust compiles from scratch.

What the tests cover:

1. Protocol and market initialization
2. Oracle configuration (feed id, freshness, confidence, decimals)
3. Trader profile creation and SPL collateral deposit
4. Open and close a profitable long (price up 10%, check PnL and reputation)
5. Pause guard — trading is blocked while protocol is paused
6. Skew guard — one-sided positions rejected when skew limits are tight
7. Funding crank — `settle_funding` advances the cumulative funding index
8. Liquidation guard — healthy positions cannot be liquidated
9. Successful liquidation — price crashes to 1,000, underwater position gets closed, reputation penalized
10. Withdraw collateral — balance decreases correctly

All 10 should pass:

```
  reputex
    ✓ initializes protocol and market
    ✓ configures market oracle validation settings
    ✓ creates a trader profile and deposits SPL collateral
    ✓ opens and closes a profitable long position
    ✓ pauses new position opens without changing existing balances
    ✓ rejects openings that exceed configured skew limits
    ✓ settles funding from market state on the crank path
    ✓ cannot liquidate a healthy position
    ✓ liquidates an underwater position
    ✓ withdraw collateral reduces balance correctly

  10 passing
```

---

## Deploying to devnet

Make sure you have devnet SOL first:

```bash
solana config set --url devnet
solana airdrop 2
# or use https://faucet.solana.com if the CLI faucet is rate limited
```

Build and deploy:

```bash
cd program
anchor build
anchor deploy --provider.cluster devnet
```

If Anchor prints a new program ID (it will on a fresh deploy), update it in three places:

1. `program/programs/reputex/src/lib.rs` — the `declare_id!()` macro
2. `program/Anchor.toml` — under `[programs.devnet]`
3. `frontend/src/config/markets.js`

Then rebuild to regenerate the IDL with the correct program ID:

```bash
anchor build
```

Bootstrap the protocol on devnet (creates the Protocol PDA, collateral mint, vault, and initial market):

```bash
npm run bootstrap:devnet
```

To configure a Pyth oracle feed at the same time:

```bash
PYTH_FEED_ID=<32-byte-hex-feed-id> npm run bootstrap:devnet
```

Copy the fresh IDL to the frontend:

```bash
cp program/target/idl/reputex.json frontend/public/idl/reputex.json
```

Start the frontend:

```bash
cd frontend
npm run dev
```

The **Live Devnet** tab connects Phantom (set to Devnet), loads the program from the IDL, and lets you send real transactions — create profile, deposit, open, close, liquidate.

---

## How the on-chain accounts work

Everything lives in PDAs. No arbitrary storage, no mutable authority keys floating around.

| Account | PDA seeds | What it holds |
|---|---|---|
| `Protocol` | `["protocol"]` | Global state: authority, trader count, market count, next position ID |
| `Market` | `["market", market_index as u64 LE]` | Price, open interest, leverage cap, maintenance margin settings |
| `TraderProfile` | `["trader", owner pubkey]` | Lifetime stats: trades, wins, losses, liquidations, PnL, reputation score |
| `MarginAccount` | `["margin", owner pubkey]` | Collateral balance and how much is currently locked in open positions |
| `Position` | `["position", owner pubkey, position_id as u64 LE]` | Everything about one open trade |

Position IDs come from `protocol.next_position_id`, which increments on every `open_position` call. This prevents anyone from crafting an arbitrary ID that collides with an existing position PDA.

---

## Instructions

**Admin only** (the wallet that called `initialize_protocol`):

- `initialize_protocol` — creates the Protocol PDA and SPL collateral vault. Call once after deploy with the collateral mint.
- `initialize_market(market_index, symbol, initial_price)` — creates a new market. Index 0 is typically SOL-PERP.
- `update_market_price(market_index, new_price)` — manual price move for local testing. Blocked once oracle pricing is enabled.
- `update_market_price_from_pyth(market_index)` — reads a Pyth `PriceUpdateV2` account, validates freshness/confidence/decimals, updates price.
- `configure_market_oracle(...)` — sets the Pyth feed id and validation limits for a market.
- `update_funding_rate(market_index, funding_delta_bps)` — updates the cumulative funding index.
- `settle_funding(market_index)` — permissionless crank that advances funding from long/short skew.
- `configure_market_risk(...)` — adjusts per-market open interest cap, skew limits, funding rate bounds.
- `set_protocol_paused(trading_paused)` — emergency pause. Blocks new opens; close/withdraw/liquidate still work.
- `fund_insurance(amount)` — adds SPL collateral to the insurance fund used to pay profitable PnL.

**Any trader** (for their own accounts):

- `create_trader_profile` — initializes `TraderProfile` and `MarginAccount` in one transaction. Reputation starts at 100.
- `deposit_collateral(amount)` — transfers SPL tokens from the trader's token account into the protocol vault, credits margin.
- `withdraw_collateral(amount)` — transfers free (unlocked) collateral back to the trader's token account.
- `open_position(position_id, market_index, is_long, collateral_amount, leverage)` — locks collateral and opens a position. Leverage is capped at the lower of the market's `max_leverage` and the trader's reputation tier.
- `close_position(position_id, market_index)` — settles at the current price, applies PnL, updates reputation.

**Permissionless** (anyone can call on any eligible position):

- `liquidate_position(position_id, market_index)` — liquidates any position that has fallen below maintenance margin (6.25%). Partial liquidation (50%) if equity is still positive; full liquidation if equity is gone.

---

## Reputation scoring

Score starts at 100 on profile creation and updates on every close or liquidation:

```
score = 100
      + (winning_trades × 8)
      + (total_trades × 3)
      + (total_volume / 1000)
      + (realized_pnl / 1000)    ← only counts if pnl > 0
      - (liquidations × 30)
      - max(0, avg_leverage_x100 - 200) / 20
```

The leverage penalty kicks in when your average leverage is above 2x. Each liquidation hits for 30 points. Winning trades and consistent volume push the score up over time.

**Reputation tiers and leverage caps:**

| Score | Max leverage |
|---|---|
| 0 – 79 | 2x |
| 80 – 119 | 3x |
| 120 – 179 | 4x |
| 180+ | 5x |

---

## PnL and liquidation math

**PnL:**

```
long PnL  = (current_price - entry_price) × size / entry_price
short PnL = (entry_price - current_price) × size / entry_price
```

Position size is `collateral × leverage`. A 500-unit collateral position at 2x has size 1000. Long entered at 10,000, price moves to 11,000: `(1000) × 1000 / 10000 = 100 PnL`.

**Liquidation threshold:**

```
equity = collateral + pnl
maintenance_margin = size × 625 / 10_000    (6.25%)

liquidatable when: equity ≤ maintenance_margin
```

Positive equity → 50% partial liquidation. Zero or negative equity → full close with bad debt recorded.

---

## Protocol constants (from `constants.rs`)

| Constant | Value | Notes |
|---|---|---|
| Starting reputation | 100 | Set on `create_trader_profile` |
| Initial margin | 20% | Equivalent to 5x max leverage |
| Maintenance margin | 6.25% | Liquidation threshold |
| Liquidation fee | 1% | Deducted on liquidation |
| Partial liquidation | 50% | When equity is still positive |
| Trading fee | 0.10% | Applied on open |
| Default max skew | 100% | Tighten after bootstrap for production |
| Max funding rate | 1% per interval | Cumulative cap |
| Oracle max age | 30 seconds | Staleness cutoff |
| Oracle max confidence | 1% | Confidence interval width |

---

## Common errors

| Error | Likely cause |
|---|---|
| `InvalidLeverage` | Leverage exceeds reputation tier or market cap |
| `InsufficientFreeCollateral` | Not enough unlocked collateral |
| `PositionNotLiquidatable` | Position is still above maintenance margin |
| `ProtocolPaused` | Protocol is paused; only closes/withdrawals allowed |
| `StaleMarketPrice` | Oracle price hasn't been refreshed recently |
| `OracleConfidenceTooWide` | Pyth confidence interval exceeds configured limit |
| `SkewLimitExceeded` | Market is too one-sided for a new position in that direction |
| `OpenInterestLimitExceeded` | Total OI cap hit for this market |
| `InvalidPositionId` | Position ID doesn't match `protocol.next_position_id` |

---

## Known limitations

- **Oracle path needs keeper setup.** Local tests use `update_market_price` for deterministic price movement. Live devnet and production should use `update_market_price_from_pyth` with fresh `PriceUpdateV2` accounts.
- **Funding keepers are not included.** `settle_funding` is permissionless and can be called by anyone, but you'll need an off-chain keeper to call it regularly.
- **Frontend live devnet tab requires devnet account setup.** You need a trader token account with test collateral before you can deposit. The UI has a `Create Token Account` button that helps with this.
- **Max leverage is 5x.** The effective cap is lower until reputation unlocks higher tiers.
- **Not audited.** Don't put real user funds at risk until independent smart contract, oracle, and deployment reviews are done.

---

## Devnet deployment checklist

Before going live on devnet, make sure you've done all of these:

- [ ] `npm run build` passes in `frontend/`
- [ ] `cargo test` passes in `program/`
- [ ] `anchor test` passes locally (all 10 tests)
- [ ] Program deployed to devnet with correct program ID in `lib.rs`, `Anchor.toml`, and `markets.js`
- [ ] `npm run bootstrap:devnet` completed successfully
- [ ] Fresh IDL copied to `frontend/public/idl/reputex.json`
- [ ] Phantom browser extension installed and set to Devnet
- [ ] Live Devnet tab can: connect wallet, load program, create token account, create profile, deposit, open, close

---

## License

Check `LICENSE` for terms.
