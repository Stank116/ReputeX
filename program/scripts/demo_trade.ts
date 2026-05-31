import * as readline from "readline";

// ── Exact constants from your program (constants.rs) ──────────────────────
const BASIS_POINTS = 10_000n;
const DEFAULT_MAINTENANCE_MARGIN_BPS = 625n;   // 6.25%
const DEFAULT_TRADING_FEE_BPS = 10n;           // 0.10%
const DEFAULT_INITIAL_MARGIN_BPS = 2_000n;     // 20%
const STARTING_REPUTATION = 100n;
const MAX_STALE_PRICE_SLOTS = 150;

// ── Exact math from your program (utils/math.rs) ──────────────────────────
function calculatePnl(isLong: boolean, size: bigint, entryPrice: bigint, currentPrice: bigint): bigint {
  const delta = isLong
    ? (currentPrice - entryPrice)
    : (entryPrice - currentPrice);
  return (delta * size) / entryPrice;
}

function maintenanceMargin(size: bigint): bigint {
  return (size * DEFAULT_MAINTENANCE_MARGIN_BPS) / BASIS_POINTS;
}

function tradingFee(size: bigint): bigint {
  return (size * DEFAULT_TRADING_FEE_BPS) / BASIS_POINTS;
}

function liquidationPrice(isLong: boolean, entryPrice: bigint, collateral: bigint, size: bigint): bigint {
  const maintMargin = maintenanceMargin(size);
  // equity = collateral + pnl = maintMargin  →  solve for price
  // pnl = (price - entry) * size / entry  (long)
  // collateral + (price - entry)*size/entry = maintMargin
  // price = entry * (collateral - maintMargin) / size + entry  (long)
  // price = entry - entry * (collateral - maintMargin) / size  (short)
  if (isLong) {
    return entryPrice - (entryPrice * (collateral - maintMargin)) / size;
  } else {
    return entryPrice + (entryPrice * (collateral - maintMargin)) / size;
  }
}

function reputationScore(
  totalTrades: bigint, winningTrades: bigint, liquidations: bigint,
  realizedPnl: bigint, totalVolume: bigint, avgLeverageX100: bigint
): bigint {
  const winBonus = winningTrades * 8n;
  const expBonus = totalTrades * 3n;
  const volBonus = totalVolume / 1_000n;
  const pnlBonus = realizedPnl > 0n ? realizedPnl / 1_000n : 0n;
  const liqPenalty = liquidations * 30n;
  const levPenalty = avgLeverageX100 > 200n ? (avgLeverageX100 - 200n) / 20n : 0n;

  const score = 100n + winBonus + expBonus + volBonus + pnlBonus;
  return score > (liqPenalty + levPenalty) ? score - liqPenalty - levPenalty : 0n;
}

function maxLeverageForReputation(rep: bigint): number {
  if (rep <= 79n) return 2;
  if (rep <= 119n) return 3;
  if (rep <= 179n) return 4;
  return 5;
}

// ── Display helpers ────────────────────────────────────────────────────────
const W = 78;
const sep  = "═".repeat(W);
const thin = "─".repeat(W);

function header(title: string) {
  console.log("\n" + sep);
  const pad = Math.floor((W - title.length) / 2);
  console.log(" ".repeat(pad) + title);
  console.log(sep);
}

function row(label: string, value: string) {
  const dots = ".".repeat(Math.max(2, W - label.length - value.length - 2));
  console.log(`  ${label}${dots}${value}`);
}

function fmt(n: bigint, decimals = 6): string {
  const abs = n < 0n ? -n : n;
  const intPart = abs / BigInt(10 ** decimals);
  const fracPart = abs % BigInt(10 ** decimals);
  const frac = fracPart.toString().padStart(decimals, "0").slice(0, 2);
  const sign = n < 0n ? "-" : "";
  return `${sign}$${intPart}.${frac}`;
}

function fmtPnl(n: bigint, decimals = 6): string {
  const s = fmt(n, decimals);
  return n >= 0n ? `+${s}` : s;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Prompt helper ──────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q: string): Promise<string> {
  return new Promise(resolve => rl.question(q, resolve));
}

// ── Market prices (simulated Pyth feed, 6 decimals) ───────────────────────
const MARKETS = [
  { symbol: "SOL-PERP", price: 158_420_000n, change: "+2.34%", oracle: "Pyth SOL/USD" },
  { symbol: "BTC-PERP", price: 68_480_000_000n, change: "-0.86%", oracle: "Coming soon" },
  { symbol: "ETH-PERP", price: 3_742_000_000n, change: "+1.18%", oracle: "Coming soon" },
  { symbol: "JUP-PERP", price: 1_170_000n, change: "+4.73%", oracle: "Coming soon" },
];

function priceTickPath(startPrice: bigint, isLong: boolean): bigint[] {
  const ticks: bigint[] = [startPrice];
  let price = startPrice;
  for (let i = 0; i < 5; i++) {
    // Simulate small random-ish moves, slightly favorable for the demo
    const move = isLong
      ? startPrice * BigInt(Math.floor(Math.random() * 150 + 30)) / 10_000n
      : -(startPrice * BigInt(Math.floor(Math.random() * 150 + 30)) / 10_000n);
    price = price + move;
    ticks.push(price);
  }
  return ticks;
}

// ── State ──────────────────────────────────────────────────────────────────
interface TraderState {
  wallet: string;
  balance: bigint;
  lockedCollateral: bigint;
  totalTrades: bigint;
  winningTrades: bigint;
  losingTrades: bigint;
  liquidations: bigint;
  totalVolume: bigint;
  realizedPnl: bigint;
  avgLeverageX100: bigint;
  reputation: bigint;
  positionCounter: bigint;
}

interface Position {
  id: bigint;
  marketSymbol: string;
  isLong: boolean;
  entryPrice: bigint;
  collateral: bigint;
  leverage: number;
  size: bigint;
  liqPrice: bigint;
  maintMargin: bigint;
  feesPaid: bigint;
}

// ── Main demo ──────────────────────────────────────────────────────────────
async function main() {
  console.clear();

  header("ReputeX  ·  Perpetuals DEX  ·  Terminal Demo");
  console.log();
  console.log("  This demo runs the exact same logic as your on-chain program.");
  console.log("  PnL, fees, liquidations, and reputation use the formulas from");
  console.log("  programs/reputex/src/utils/math.rs and constants.rs.");
  console.log();
  console.log(thin);

  // ── Wallet ──
  const rawWallet = await ask("\n  Enter your wallet address: ");
  const wallet = rawWallet.trim();
  if (wallet.length < 10) {
    console.log("  Invalid address, using demo wallet.");
  }
  const displayWallet = wallet.length > 20
    ? wallet.slice(0, 6) + "..." + wallet.slice(-6)
    : wallet;

  // ── Deposit ──
  const rawDeposit = await ask("  Enter deposit amount in USD (e.g. 2500): ");
  const depositUsd = Math.max(100, Math.min(100000, parseFloat(rawDeposit) || 2500));
  const depositAmount = BigInt(Math.floor(depositUsd * 1_000_000));

  const state: TraderState = {
    wallet,
    balance: depositAmount,
    lockedCollateral: 0n,
    totalTrades: 0n,
    winningTrades: 0n,
    losingTrades: 0n,
    liquidations: 0n,
    totalVolume: 0n,
    realizedPnl: 0n,
    avgLeverageX100: 0n,
    reputation: STARTING_REPUTATION,
    positionCounter: 0n,
  };

  let trading = true;

  while (trading) {
    // ── Show markets ──
    header("Available Markets");
    console.log();
    console.log("  #   Symbol      Price             24h       Oracle");
    console.log("  " + thin.slice(0, 62));
    MARKETS.forEach((m, i) => {
      const priceStr = fmt(m.price).padEnd(18);
      console.log(`  ${i}   ${m.symbol.padEnd(12)}${priceStr}${m.change.padEnd(10)}${m.oracle}`);
    });

    // ── Show wallet state ──
    header("Your Account");
    row("Wallet", displayWallet);
    row("Balance", fmt(state.balance));
    row("Locked collateral", fmt(state.lockedCollateral));
    row("Free collateral", fmt(state.balance - state.lockedCollateral));
    row("Reputation score", state.reputation.toString());
    row("Max leverage available", maxLeverageForReputation(state.reputation) + "x");
    row("Total trades", state.totalTrades.toString());
    row("Realized PnL", fmtPnl(state.realizedPnl));
    console.log();

    // ── Choose market ──
    const mRaw = await ask("  Select market (0-3): ");
    const mIdx = Math.max(0, Math.min(3, parseInt(mRaw) || 0));
    const market = MARKETS[mIdx];

    // ── Choose side ──
    const sideRaw = (await ask("  Side — (L)ong or (S)hort: ")).trim().toUpperCase();
    const isLong = sideRaw !== "S";

    // ── Choose leverage ──
    const maxLev = maxLeverageForReputation(state.reputation);
    const levRaw = await ask(`  Leverage (1-${maxLev}x, your reputation allows ${maxLev}x): `);
    const leverage = Math.max(1, Math.min(maxLev, parseInt(levRaw) || 1));

    // ── Choose collateral ──
    const freeCollateral = state.balance - state.lockedCollateral;
    const colRaw = await ask(`  Collateral to use in USD (max ${fmt(freeCollateral)}): `);
    const colUsd = Math.max(10, Math.min(parseFloat(colRaw) || 500, Number(freeCollateral) / 1_000_000));
    const collateral = BigInt(Math.floor(colUsd * 1_000_000));

    // ── Validate like the program does ──
    const size = collateral * BigInt(leverage);
    const fee = tradingFee(size);
    const initialMarginRequired = (size * DEFAULT_INITIAL_MARGIN_BPS) / BASIS_POINTS;

    if (collateral < initialMarginRequired) {
      console.log(`\n  ❌ Initial margin too low. Need at least ${fmt(initialMarginRequired)}.`);
      await sleep(1500);
      continue;
    }
    if (collateral + fee > freeCollateral) {
      console.log(`\n  ❌ Insufficient free collateral (need ${fmt(collateral + fee)} including fees).`);
      await sleep(1500);
      continue;
    }

    const posId = state.positionCounter;
    state.positionCounter += 1n;
    const entryPrice = market.price;
    const liqPrice = liquidationPrice(isLong, entryPrice, collateral, size);
    const maintMargin = maintenanceMargin(size);

    // Apply fee
    state.balance -= fee;
    state.lockedCollateral += collateral;

    const pos: Position = {
      id: posId,
      marketSymbol: market.symbol,
      isLong,
      entryPrice,
      collateral,
      leverage,
      size,
      liqPrice,
      maintMargin,
      feesPaid: fee,
    };

    // ── Show position opened ──
    header(`Position #${posId} Opened`);
    row("Market", pos.marketSymbol);
    row("Side", pos.isLong ? "LONG  🟢" : "SHORT 🔴");
    row("Leverage", leverage + "x");
    row("Collateral locked", fmt(pos.collateral));
    row("Position size", fmt(pos.size));
    row("Entry price", fmt(pos.entryPrice));
    row("Liquidation price", fmt(pos.liqPrice));
    row("Maintenance margin", fmt(pos.maintMargin));
    row("Trading fee paid", fmt(pos.feesPaid));
    console.log();

    // ── Simulate price ticks ──
    header("Live Mark Price & PnL");
    console.log();
    const priceTicks = priceTickPath(entryPrice, isLong);
    let liquidated = false;
    let finalPrice = entryPrice;

    for (let tick = 1; tick < priceTicks.length; tick++) {
      await sleep(800);
      const markPrice = priceTicks[tick];
      const pnl = calculatePnl(isLong, size, entryPrice, markPrice);
      const equity = collateral + pnl;
      const isLiquidatable = equity <= maintMargin;
      const healthStr = isLiquidatable ? "⚠️  LIQUIDATABLE" : "Healthy ✅";

      console.log(`  Tick ${tick}`);
      row("  Mark price", fmt(markPrice));
      row("  Unrealized PnL", fmtPnl(pnl));
      row("  Position equity", fmt(equity));
      row("  Health", healthStr);
      console.log();

      finalPrice = markPrice;

      if (isLiquidatable) {
        liquidated = true;
        break;
      }
    }

    if (liquidated) {
      // ── Liquidation ──
      header("⚠️  Position Liquidated");
      const pnl = calculatePnl(isLong, size, entryPrice, finalPrice);
      row("Entry price", fmt(entryPrice));
      row("Liquidation price", fmt(finalPrice));
      row("Loss", fmtPnl(pnl));

      const loss = pnl < 0n ? -pnl : 0n;
      const collectible = loss < collateral ? loss : collateral;
      state.balance -= collectible;
      state.lockedCollateral -= collateral;
      state.liquidations += 1n;
      state.losingTrades += 1n;
      state.totalTrades += 1n;
      state.totalVolume += size;
      state.realizedPnl += pnl;

      const newLev = state.totalTrades === 0n ? BigInt(leverage * 100)
        : (state.avgLeverageX100 * (state.totalTrades - 1n) + BigInt(leverage * 100)) / state.totalTrades;
      state.avgLeverageX100 = newLev;
      state.reputation = reputationScore(
        state.totalTrades, state.winningTrades, state.liquidations,
        state.realizedPnl, state.totalVolume, state.avgLeverageX100);

      row("New balance", fmt(state.balance));
      row("Liquidations", state.liquidations.toString());
      row("Reputation score", state.reputation.toString() + "  (−30 liquidation penalty)");
      console.log();
    } else {
      // ── Close position ──
      const closeRaw = await ask("  Close position now? (y/n): ");
      const shouldClose = closeRaw.trim().toLowerCase() !== "n";

      if (shouldClose) {
        const exitPrice = finalPrice;
        const pnl = calculatePnl(isLong, size, entryPrice, exitPrice);

        header("Position Closed");
        row("Exit price", fmt(exitPrice));
        row("Realized PnL", fmtPnl(pnl));

        // Apply PnL
        state.lockedCollateral -= collateral;
        state.balance += pnl;   // add/subtract PnL from balance

        if (pnl >= 0n) {
          state.winningTrades += 1n;
        } else {
          state.losingTrades += 1n;
        }
        state.totalTrades += 1n;
        state.totalVolume += size;
        state.realizedPnl += pnl;

        const newLev = state.totalTrades === 1n ? BigInt(leverage * 100)
          : (state.avgLeverageX100 * (state.totalTrades - 1n) + BigInt(leverage * 100)) / state.totalTrades;
        state.avgLeverageX100 = newLev;
        state.reputation = reputationScore(
          state.totalTrades, state.winningTrades, state.liquidations,
          state.realizedPnl, state.totalVolume, state.avgLeverageX100);

        row("New balance", fmt(state.balance));
        row("Total trades", state.totalTrades.toString());
        row("Winning trades", state.winningTrades.toString());
        row("Total volume", fmt(state.totalVolume));
        row("Reputation score", state.reputation.toString());
        row("Max leverage now", maxLeverageForReputation(state.reputation) + "x");
        console.log();
      } else {
        // Keep position open - just unlock for demo purposes
        state.lockedCollateral -= collateral;
        console.log("\n  Position kept open (simulation — re-run to continue trading).\n");
      }
    }

    // ── Continue? ──
    header("Trade Again?");
    const again = await ask("  Open another position? (y/n): ");
    if (again.trim().toLowerCase() !== "y") {
      trading = false;
    }
  }

  // ── Final summary ──
  header("Session Summary");
  row("Wallet", displayWallet);
  row("Final balance", fmt(state.balance));
  row("Total trades", state.totalTrades.toString());
  row("Winning trades", state.winningTrades.toString());
  row("Losing trades", state.losingTrades.toString());
  row("Liquidations", state.liquidations.toString());
  row("Total volume", fmt(state.totalVolume));
  row("Realized PnL", fmtPnl(state.realizedPnl));
  row("Reputation score", state.reputation.toString());
  row("Max leverage unlocked", maxLeverageForReputation(state.reputation) + "x");
  console.log();
  console.log("  Math source: programs/reputex/src/utils/math.rs");
  console.log("  On-chain program: EcKorS8y9kXHXQDjzN9eBYuhKqtdDFhypD9ceYfFKpfH");
  console.log("  Explorer: https://explorer.solana.com/?cluster=devnet");
  console.log();
  console.log(sep + "\n");

  rl.close();
}

main().catch(e => { console.error(e); rl.close(); });
