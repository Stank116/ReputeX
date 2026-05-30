# ReputeX

A perpetuals DEX built on Solana where your trading history actually means something. Every position you open, close, or get liquidated on feeds into an on-chain reputation score that determines how much leverage you can access.

Built with Anchor 0.32.1 on Solana devnet.

---

## What this is

Most perps protocols give every wallet the same max leverage regardless of track record. ReputeX flips that — your reputation score goes up when you trade profitably and falls when you get rekt. New wallets start at 100 points and have to earn higher leverage through consistent performance.

Collateral deposits and withdrawals move SPL tokens into and out of a protocol vault PDA. Trader balances are still tracked on-chain in `MarginAccount`, so the protocol can lock collateral, apply PnL, and enforce free-collateral checks.

---

## How the accounts work

Everything lives in PDAs. No arbitrary data storage, no mutable authority keys floating around.

| Account         | Seed                                             | What it holds                                                              |
| --------------- | ------------------------------------------------ | -------------------------------------------------------------------------- |
| `Protocol`      | `["protocol"]`                                   | Global state — authority pubkey, trader/market counts, next position ID    |
| `Market`        | `["market", market_index u64 LE]`                | Price, open interest, leverage cap, maintenance margin settings            |
| `TraderProfile` | `["trader", owner pubkey]`                       | Lifetime stats — trades, wins, losses, liquidations, PnL, reputation score |
| `MarginAccount` | `["margin", owner pubkey]`                       | Collateral balance and how much of it is currently locked in positions     |
| `Position`      | `["position", owner pubkey, position_id u64 LE]` | Everything about one open trade                                            |

One thing worth noting: `position_id` comes from `protocol.next_position_id` which increments on every `open_position` call. This prevents anyone from passing an arbitrary ID that collides with an existing position PDA.

---

## Instructions

**Admin instructions** — only the wallet that called `initialize_protocol` can run these:

- `initialize_protocol` — sets up the Protocol PDA and SPL collateral vault. Call this once after deploying with the collateral mint you want to accept.
- `initialize_market(market_index, symbol, initial_price)` — creates a new market. Market index 0 is typically SOL-PERP.
- `update_market_price(market_index, new_price)` — moves the oracle price. On mainnet you'd replace this with a Pyth feed; on devnet this lets tests drive prices.
- `update_funding_rate(market_index, funding_delta_bps)` — updates the cumulative funding index used when positions close or liquidate.
- `fund_insurance(amount)` — transfers SPL collateral into the protocol vault and credits the insurance fund used to pay profitable PnL.

**Trader instructions** — any wallet can call these for themselves:

- `create_trader_profile` — initialises your TraderProfile and MarginAccount in one transaction.
- `deposit_collateral(amount)` — transfers SPL collateral from the trader token account into the protocol vault and credits margin.
- `withdraw_collateral(amount)` — transfers free (unlocked) SPL collateral from the protocol vault back to the trader.
- `open_position(position_id, market_index, is_long, collateral_amount, leverage)` — locks collateral and opens a long or short. Leverage must be between 1 and the lower of the market's `max_leverage` and the trader's reputation tier.
- `close_position(position_id, market_index)` — settles your position at current price, applies PnL to your balance, and updates your reputation.

**Permissionless:**

- `liquidate_position(position_id, market_index)` — anyone can call this on any position that has fallen below its maintenance margin (6.25% of position size by default). The liquidated trader's collateral is wiped and their liquidation count goes up, which hits their reputation score hard.

---

## Reputation scoring

Your score starts at 100 when you create a profile. It goes up over time as you trade:

```
score = 100
      + (winning_trades × 8)
      + (total_trades × 3)
      + (total_volume / 1000)
      + (realized_pnl / 1000)   [only if pnl > 0]
      - (liquidations × 30)
      - max(0, avg_leverage_x100 - 200) / 20
```

The leverage penalty kicks in if your average leverage exceeds 2x. Each liquidation costs 30 points. High win rate and consistent volume push the score up over time.

Reputation also gates maximum leverage:

| Score   | Max leverage |
| ------- | -----------: |
| 0-79    |           2x |
| 80-119  |           3x |
| 120-179 |           4x |
| 180+    |           5x |

---

## PnL and liquidation math

**PnL calculation:**

```
long PnL  = (current_price - entry_price) × size / entry_price
short PnL = (entry_price - current_price) × size / entry_price
```

Position size is `collateral × leverage`, so a 500-unit collateral position at 2x leverage has size 1000. If you entered a long at 10,000 and the price moves to 11,000, your PnL is `(1000) × 1000 / 10000 = 100`.

**Liquidation condition:**

```
equity = collateral + pnl
maintenance_margin = size × 625 / 10000   (6.25%)

position is liquidatable when: equity ≤ maintenance_margin
```

---

## Running the tests

You need Anchor 0.32.1, Rust, and Node.js ≥ 18. If you haven't set those up yet, follow the [Anchor installation guide](https://www.anchor-lang.com/docs/installation).

```bash
cd program
yarn install
anchor test
```

`anchor test` spins up a local validator, deploys the program, runs all tests, and tears everything down. First run takes a few minutes because Rust is compiling from scratch.

What the test suite covers:

1. Protocol and market initialization — checks that accounts are created with correct initial values
2. Trader profile creation and collateral deposit — verifies starting reputation score of 100 and clean balance
3. Open and close a profitable long — moves price up 10%, closes position, checks PnL math and reputation update
4. Liquidation guard — tries to liquidate a healthy position and confirms the program rejects it
5. Successful liquidation — crashes price to 1,000, confirms the underwater position gets liquidated, checks reputation penalty
6. Withdraw collateral — verifies the balance decreases correctly

All 6 tests should pass with output like:

```
  reputex
    ✓ initializes protocol and market
    ✓ creates a trader profile and deposits SPL collateral
    ✓ opens and closes a profitable long position
    ✓ cannot liquidate a healthy position
    ✓ liquidates an underwater position
    ✓ withdraw collateral reduces balance correctly

  6 passing (Xs)
```

---

## Deploying to devnet

Make sure you have devnet SOL first (`solana airdrop 2` or use the [faucet](https://faucet.solana.com)).

```bash
# Switch to devnet
solana config set --url devnet

# Build
anchor build

# Deploy — this will take a minute
anchor deploy --provider.cluster devnet
```

After deployment, copy the printed program ID and update it in two places:

1. `src/lib.rs` — the `declare_id!()` macro
2. `Anchor.toml` — under `[programs.devnet]`

Then rebuild:

```bash
anchor build
```

Verify the program is live:

```
solana program show <YOUR_PROGRAM_ID> --url devnet
```

You should see `Executable: true`.

---

## Project structure

```
program/
├── Anchor.toml
├── Cargo.toml
├── package.json
├── tsconfig.json
│
├── programs/reputex/src/
│   ├── lib.rs                        ← program entry, instruction dispatch
│   ├── constants.rs                  ← leverage limits, BPS values, seeds
│   ├── errors.rs                     ← all custom error codes
│   │
│   ├── state/
│   │   ├── protocol.rs
│   │   ├── market.rs
│   │   ├── trader_profile.rs
│   │   ├── margin_account.rs
│   │   └── position.rs
│   │
│   ├── instructions/
│   │   ├── initialize_protocol.rs
│   │   ├── initialize_market.rs
│   │   ├── create_trader_profile.rs
│   │   ├── deposit_collateral.rs
│   │   ├── withdraw_collateral.rs
│   │   ├── update_market_price.rs
│   │   ├── open_position.rs
│   │   ├── close_position.rs
│   │   └── liquidate_position.rs
│   │
│   └── utils/
│       ├── math.rs                   ← PnL, liquidation, size, reputation calc
│       └── mod.rs
│
└── tests/
    └── reputex.ts                    ← full test suite
```

---

## Known limitations

- **Single admin oracle.** `update_market_price` is gated to the protocol authority. A production version should use Pyth or another battle-tested oracle feed with staleness/confidence checks.
- **Funding is admin-updated.** Funding payments are settled through a cumulative funding index and the insurance fund, but production should automate the update cadence from market skew.
- **Market max leverage is capped at 5x.** The effective max is lower for traders whose reputation tier has not unlocked the full market cap.
- **Not audited.** Do not put real user funds at risk until this has independent security review, oracle review, and deployment/runbook hardening.
