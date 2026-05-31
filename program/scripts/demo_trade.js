#!/usr/bin/env node
"use strict";

const readline = require("readline");

const BASIS_POINTS         = 10000n;
const MAINT_MARGIN_BPS     = 625n;
const TRADING_FEE_BPS      = 10n;
const INITIAL_MARGIN_BPS   = 2000n;
const STARTING_REPUTATION  = 100n;

function calcPnl(isLong, size, entry, current) {
  const delta = isLong ? (current - entry) : (entry - current);
  return (delta * size) / entry;
}
function maintMargin(size)   { return (size * MAINT_MARGIN_BPS) / BASIS_POINTS; }
function tradingFee(size)    { return (size * TRADING_FEE_BPS)  / BASIS_POINTS; }
function initMarginReq(size) { return (size * INITIAL_MARGIN_BPS) / BASIS_POINTS; }

function liqPrice(isLong, entry, collateral, size) {
  const mm = maintMargin(size);
  if (isLong) return entry - (entry * (collateral - mm)) / size;
  else        return entry + (entry * (collateral - mm)) / size;
}

function reputationScore(totalTrades, wins, liqs, realizedPnl, volume, avgLevX100) {
  const winBonus  = wins * 8n;
  const expBonus  = totalTrades * 3n;
  const volBonus  = volume / 1_000_000n;
  const pnlBonus  = realizedPnl > 0n ? realizedPnl / 1000n : 0n;
  const liqPen    = liqs * 30n;
  const levPen    = avgLevX100 > 200n ? (avgLevX100 - 200n) / 20n : 0n;
  const raw = 100n + winBonus + expBonus + volBonus + pnlBonus;
  return raw > (liqPen + levPen) ? raw - liqPen - levPen : 0n;
}

function maxLev(rep) {
  if (rep <= 79n)  return 2;
  if (rep <= 119n) return 3;
  if (rep <= 179n) return 4;
  return 5;
}

const W   = 76;
const SEP = "═".repeat(W);
const THN = "─".repeat(W);

function header(title) {
  console.log("\n" + SEP);
  const pad = Math.floor((W - title.length) / 2);
  console.log(" ".repeat(Math.max(0, pad)) + title);
  console.log(SEP);
}
function row(label, value) {
  const dots = ".".repeat(Math.max(2, W - label.length - value.length - 2));
  console.log(`  ${label}${dots}${value}`);
}
function fmt(n) {
  const neg  = n < 0n;
  const abs  = neg ? -n : n;
  const int  = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${neg ? "-" : ""}$${int}.${frac}`;
}
function fmtPnl(n) { return (n >= 0n ? "+" : "") + fmt(n); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function priceTicks(start, isLong) {
  const ticks = [start];
  let p = start;
  for (let i = 0; i < 5; i++) {
    const bps = BigInt(Math.floor(Math.random() * 150 + 30));
    p = isLong ? p + (start * bps) / 10000n
               : p - (start * bps) / 10000n;
    ticks.push(p);
  }
  return ticks;
}

const MARKETS = [
  { symbol: "SOL-PERP", price: 158_420_000n, change: "+2.34%", oracle: "Pyth SOL/USD" },
  { symbol: "BTC-PERP", price: 68_480_000_000n, change: "-0.86%", oracle: "Coming soon"  },
  { symbol: "ETH-PERP", price: 3_742_000_000n,  change: "+1.18%", oracle: "Coming soon"  },
  { symbol: "JUP-PERP", price: 1_170_000n,      change: "+4.73%", oracle: "Coming soon"  },
];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(res => rl.question(q, res)); }

async function main() {
  console.clear();
  header("ReputeX  ·  Perpetuals DEX  ·  Terminal Demo");
  console.log();
  console.log("  Uses exact math from programs/reputex/src/utils/math.rs");
  console.log("  PnL · fees · liquidation · reputation all match on-chain logic");
  console.log();
  console.log(THN);

  const rawWallet = (await ask("\n  Enter your wallet address: ")).trim();
  const wallet = rawWallet.length > 10 ? rawWallet : "DemoWallet";
  const shortW = wallet.length > 20 ? wallet.slice(0,6) + "..." + wallet.slice(-6) : wallet;

  const rawDep = await ask("  Deposit amount in USD (e.g. 2500): ");
  const depUsd = Math.max(100, Math.min(100000, parseFloat(rawDep) || 2500));
  const balance0 = BigInt(Math.floor(depUsd * 1_000_000));

  let balance = balance0, locked = 0n;
  let totalTrades = 0n, wins = 0n, losses = 0n, liqs = 0n;
  let volume = 0n, realizedPnl = 0n, avgLevX100 = 0n;
  let rep = STARTING_REPUTATION;
  let posCounter = 0n;
  let trading = true;

  while (trading) {
    header("Available Markets");
    console.log();
    console.log("  #   Symbol       Price              24h        Oracle");
    console.log("  " + THN.slice(0,68));
    MARKETS.forEach((m, i) => {
      console.log(`  ${i}   ${m.symbol.padEnd(13)}${fmt(m.price).padEnd(19)}${m.change.padEnd(11)}${m.oracle}`);
    });

    header("Your Account");
    row("Wallet",            shortW);
    row("Balance",           fmt(balance));
    row("Locked collateral", fmt(locked));
    row("Free collateral",   fmt(balance - locked));
    row("Reputation score",  rep.toString());
    row("Max leverage",      maxLev(rep) + "x");
    row("Total trades",      totalTrades.toString());
    row("Realized PnL",      fmtPnl(realizedPnl));
    console.log();

    const mIdx  = Math.max(0, Math.min(3, parseInt(await ask("  Select market (0-3): ")) || 0));
    const mkt   = MARKETS[mIdx];
    const sRaw  = (await ask("  Side — L(ong) or S(hort): ")).trim().toUpperCase();
    const isLong = sRaw !== "S";
    const ml    = maxLev(rep);
    const lev   = Math.max(1, Math.min(ml, parseInt(await ask(`  Leverage 1-${ml}x (your rep allows ${ml}x): `)) || 1));
    const free  = balance - locked;
    const cRaw  = await ask(`  Collateral in USD (max ${fmt(free)}): `);
    const cUsd  = Math.max(10, Math.min(parseFloat(cRaw) || 500, Number(free) / 1_000_000));
    const col   = BigInt(Math.floor(cUsd * 1_000_000));
    const size  = col * BigInt(lev);
    const fee   = tradingFee(size);
    const initMR = initMarginReq(size);

    if (col < initMR) {
      console.log(`\n  ❌ InitialMarginTooLow — need at least ${fmt(initMR)}.`);
      await sleep(1500); continue;
    }
    if (col + fee > free) {
      console.log(`\n  ❌ InsufficientFreeCollateral — need ${fmt(col + fee)}, have ${fmt(free)}.`);
      await sleep(1500); continue;
    }

    const entry  = mkt.price;
    const liqP   = liqPrice(isLong, entry, col, size);
    const mm     = maintMargin(size);
    const posId  = posCounter++;

    balance -= fee;
    locked  += col;

    header(`Position #${posId} Opened — ${isLong ? "LONG 🟢" : "SHORT 🔴"} ${mkt.symbol}`);
    row("Entry price",       fmt(entry));
    row("Collateral locked", fmt(col));
    row("Position size",     fmt(size));
    row("Leverage",          lev + "x");
    row("Liquidation price", fmt(liqP));
    row("Maint. margin",     fmt(mm));
    row("Trading fee paid",  fmt(fee));
    console.log();

    header("Live Mark Price  &  PnL");
    console.log();
    const ticks = priceTicks(entry, isLong);
    let liquidated = false, finalPrice = entry;

    for (let t = 1; t < ticks.length; t++) {
      await sleep(900);
      const mark   = ticks[t];
      const pnl    = calcPnl(isLong, size, entry, mark);
      const equity = col + pnl;
      const liqNow = equity <= mm;
      console.log(`  Tick ${t}`);
      row("  Mark price",      fmt(mark));
      row("  Unrealized PnL",  fmtPnl(pnl));
      row("  Position equity", fmt(equity));
      row("  Health",          liqNow ? "⚠️  LIQUIDATABLE" : "Healthy ✅");
      console.log();
      finalPrice = mark;
      if (liqNow) { liquidated = true; break; }
    }

    if (liquidated) {
      header("⚠️  Position Liquidated");
      const pnl = calcPnl(isLong, size, entry, finalPrice);
      const loss = pnl < 0n ? -pnl : 0n;
      const deducted = loss < col ? loss : col;
      balance -= deducted; locked -= col;
      liqs += 1n; losses += 1n; totalTrades += 1n; volume += size; realizedPnl += pnl;
      const newLev = BigInt(lev * 100);
      avgLevX100 = totalTrades === 1n ? newLev : (avgLevX100 * (totalTrades-1n) + newLev) / totalTrades;
      rep = reputationScore(totalTrades, wins, liqs, realizedPnl, volume, avgLevX100);
      row("Loss",           fmtPnl(pnl));
      row("Balance after",  fmt(balance));
      row("Liquidations",   liqs.toString());
      row("Reputation",     rep.toString() + "  (−30 penalty)");
      console.log();
    } else {
      const closeRaw = (await ask("  Close position now? (y/n): ")).trim().toLowerCase();
      if (closeRaw !== "n") {
        const pnl = calcPnl(isLong, size, entry, finalPrice);
        locked -= col; balance += pnl;
        pnl >= 0n ? wins++ : losses++;
        totalTrades += 1n; volume += size; realizedPnl += pnl;
        const newLev = BigInt(lev * 100);
        avgLevX100 = totalTrades === 1n ? newLev : (avgLevX100 * (totalTrades-1n) + newLev) / totalTrades;
        rep = reputationScore(totalTrades, wins, liqs, realizedPnl, volume, avgLevX100);
        header("Position Closed");
        row("Exit price",       fmt(finalPrice));
        row("Realized PnL",     fmtPnl(pnl));
        row("New balance",      fmt(balance));
        row("Total trades",     totalTrades.toString());
        row("Winning trades",   wins.toString());
        row("Total volume",     fmt(volume));
        row("Reputation",       rep.toString());
        row("Max leverage now", maxLev(rep) + "x");
        console.log();
      }
    }

    const again = (await ask("  Open another position? (y/n): ")).trim().toLowerCase();
    if (again !== "y") trading = false;
  }

  header("Session Summary");
  row("Wallet",        shortW);
  row("Final balance", fmt(balance));
  row("Total trades",  totalTrades.toString());
  row("Wins / Losses", `${wins} / ${losses}`);
  row("Liquidations",  liqs.toString());
  row("Total volume",  fmt(volume));
  row("Realized PnL",  fmtPnl(realizedPnl));
  row("Reputation",    rep.toString());
  row("Max leverage",  maxLev(rep) + "x");
  console.log();
  console.log("  Program:  EcKorS8y9kXHXQDjzN9eBYuhKqtdDFhypD9ceYfFKpfH");
  console.log("  Explorer: https://explorer.solana.com/?cluster=devnet");
  console.log("\n" + SEP + "\n");
  rl.close();
}

main().catch(e => { console.error(e); rl.close(); process.exit(1); });
