import { useEffect, useMemo, useRef, useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";

const BASIS_POINTS = 10000;
const MAINTENANCE_MARGIN_BPS = 625;
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

const initialMarkets = [
  {
    symbol: "SOL-PERP",
    base: "SOL",
    price: 158.42,
    funding: 0.012,
    change: 2.34,
    maxLev: 5,
  },
  {
    symbol: "BTC-PERP",
    base: "BTC",
    price: 68480,
    funding: -0.004,
    change: -0.86,
    maxLev: 5,
  },
  {
    symbol: "ETH-PERP",
    base: "ETH",
    price: 3742,
    funding: 0.008,
    change: 1.18,
    maxLev: 5,
  },
  {
    symbol: "JUP-PERP",
    base: "JUP",
    price: 1.17,
    funding: 0.021,
    change: 4.73,
    maxLev: 4,
  },
];

const startingProfile = {
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  liquidations: 0,
  totalVolume: 0,
  realizedPnl: 0,
  avgLeverageX100: 0,
  reputationScore: 100,
};

const fmt = (value, digits = 2) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
const pct = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function seedHistory(markets) {
  return markets.map((market) =>
    Array.from({ length: 72 }, (_, i) => {
      const wave = Math.sin(i / 7) * market.price * 0.012;
      const drift = (i - 36) * market.price * 0.0005;
      return market.price + wave + drift;
    })
  );
}

function reputationLeverageCap(score, marketMax) {
  if (score < 80) return Math.min(2, marketMax);
  if (score < 120) return Math.min(3, marketMax);
  if (score < 180) return Math.min(4, marketMax);
  return Math.min(5, marketMax);
}

function calculateReputation(profile) {
  const winBonus = profile.winningTrades * 8;
  const experienceBonus = profile.totalTrades * 3;
  const volumeBonus = Math.floor(profile.totalVolume / 1000);
  const pnlBonus =
    profile.realizedPnl > 0 ? Math.floor(profile.realizedPnl / 1000) : 0;
  const liquidationPenalty = profile.liquidations * 30;
  const leveragePenalty = Math.floor(
    Math.max(profile.avgLeverageX100 - 200, 0) / 20
  );
  return Math.max(
    0,
    100 +
      winBonus +
      experienceBonus +
      volumeBonus +
      pnlBonus -
      liquidationPenalty -
      leveragePenalty
  );
}

function u64Le(value) {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigUint64(0, BigInt(value), true);
  return new Uint8Array(buffer);
}

function App() {
  const [view, setView] = useState("terminal");

  return (
    <main className="terminal-shell">
      <header className="topbar">
        <section className="brand-block" aria-label="Protocol summary">
          <div className="brand-mark">RX</div>
          <div>
            <h1>ReputeX</h1>
            <p>Perpetuals DEX trading terminal</p>
          </div>
        </section>
        <nav className="app-tabs" aria-label="Frontend mode">
          <button
            className={view === "terminal" ? "active" : ""}
            type="button"
            onClick={() => setView("terminal")}
          >
            Terminal
          </button>
          <button
            className={view === "live" ? "active" : ""}
            type="button"
            onClick={() => setView("live")}
          >
            Live Devnet
          </button>
        </nav>
      </header>
      {view === "terminal" ? <TradingTerminal /> : <LiveDevnetConsole />}
    </main>
  );
}

function TradingTerminal() {
  const [markets, setMarkets] = useState(() => {
    const history = seedHistory(initialMarkets);
    return initialMarkets.map((market, index) => ({
      ...market,
      price: history[index].at(-1),
    }));
  });
  const [history, setHistory] = useState(() => seedHistory(initialMarkets));
  const [connected, setConnected] = useState(false);
  const [activeMarket, setActiveMarket] = useState(0);
  const [side, setSide] = useState("long");
  const [balance, setBalance] = useState(0);
  const [locked, setLocked] = useState(0);
  const [positions, setPositions] = useState([]);
  const [nextPositionId, setNextPositionId] = useState(0);
  const [profile, setProfile] = useState(startingProfile);
  const [activity, setActivity] = useState(["Session ready"]);
  const [collateralInput, setCollateralInput] = useState(500);
  const [cashInput, setCashInput] = useState(2500);
  const [leverageInput, setLeverageInput] = useState(2);
  const [ticketMessage, setTicketMessage] = useState("");
  const [timeframe, setTimeframe] = useState("1m");

  const active = markets[activeMarket];
  const maxLeverage = reputationLeverageCap(
    profile.reputationScore,
    active.maxLev
  );
  const leverage = Math.min(Number(leverageInput) || 1, maxLeverage);

  const positionPnl = (position, marketList = markets) => {
    const mark = marketList[position.marketIndex].price;
    const delta = position.isLong
      ? mark - position.entryPrice
      : position.entryPrice - mark;
    return (delta * position.size) / position.entryPrice;
  };
  const maintenanceMargin = (position) =>
    (position.size * MAINTENANCE_MARGIN_BPS) / BASIS_POINTS;
  const positionEquity = (position, marketList = markets) =>
    position.collateral + positionPnl(position, marketList);
  const freeCollateral = Math.max(balance - locked, 0);
  const unrealizedPnl = positions.reduce(
    (sum, position) => sum + positionPnl(position),
    0
  );
  const accountEquity = balance + unrealizedPnl;

  const log = (message) => {
    const stamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    setActivity((entries) => [`${stamp} - ${message}`, ...entries].slice(0, 8));
  };

  const closePosition = (id, liquidated = false, marketList = markets) => {
    setPositions((current) => {
      const position = current.find((item) => item.id === id);
      if (!position) return current;
      const pnl = positionPnl(position, marketList);
      setLocked((value) => Math.max(value - position.collateral, 0));
      setBalance((value) =>
        liquidated
          ? Math.max(value - position.collateral, 0)
          : Math.max(value + pnl, 0)
      );
      setProfile((oldProfile) => {
        const totalTrades = oldProfile.totalTrades + 1;
        const newLeverage = position.leverage * 100;
        const avgLeverageX100 =
          oldProfile.totalTrades === 0
            ? newLeverage
            : Math.floor(
                (oldProfile.avgLeverageX100 * oldProfile.totalTrades +
                  newLeverage) /
                  totalTrades
              );
        const updated = {
          ...oldProfile,
          totalTrades,
          winningTrades:
            pnl > 0 && !liquidated
              ? oldProfile.winningTrades + 1
              : oldProfile.winningTrades,
          losingTrades:
            pnl <= 0 || liquidated
              ? oldProfile.losingTrades + 1
              : oldProfile.losingTrades,
          liquidations: liquidated
            ? oldProfile.liquidations + 1
            : oldProfile.liquidations,
          totalVolume: oldProfile.totalVolume + position.size,
          realizedPnl: oldProfile.realizedPnl + pnl,
          avgLeverageX100,
        };
        return {
          ...updated,
          reputationScore: calculateReputation(updated),
        };
      });
      log(
        `${liquidated ? "Liquidated" : "Closed"} ${
          marketList[position.marketIndex].symbol
        } ${pnl >= 0 ? "+" : ""}${fmt(pnl)}`
      );
      return current.filter((item) => item.id !== id);
    });
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setMarkets((currentMarkets) => {
        const nextMarkets = currentMarkets.map((market, index) => {
          const bias = market.change / 2400;
          const wave = Math.sin(Date.now() / 9000 + index) * 0.0009;
          const impulse = (Math.random() - 0.5) * 0.0035;
          const price = Math.max(
            market.price * (1 + bias + wave + impulse),
            0.01
          );
          return {
            ...market,
            price,
            change: market.change * 0.985 + (bias + impulse) * 120,
          };
        });
        setHistory((oldHistory) =>
          oldHistory.map((points, index) => {
            const updated = [...points, nextMarkets[index].price];
            return updated.length > 90 ? updated.slice(1) : updated;
          })
        );
        positions
          .filter(
            (position) =>
              positionEquity(position, nextMarkets) <=
              maintenanceMargin(position)
          )
          .forEach((position) => closePosition(position.id, true, nextMarkets));
        return nextMarkets;
      });
    }, 1800);
    return () => clearInterval(timer);
  }, [positions]);

  const openInterestFor = (index) =>
    positions
      .filter((position) => position.marketIndex === index)
      .reduce((sum, position) => sum + position.size, 0);

  const openPosition = () => {
    if (!connected) {
      setTicketMessage("Connect a wallet first.");
      return;
    }
    const collateral = Number(collateralInput);
    if (!Number.isFinite(collateral) || collateral <= 0) {
      setTicketMessage("Collateral must be above zero.");
      return;
    }
    if (leverage < 1 || leverage > maxLeverage) {
      setTicketMessage(`Current reputation allows up to ${maxLeverage}x.`);
      return;
    }
    if (freeCollateral < collateral) {
      setTicketMessage("Insufficient free collateral.");
      return;
    }

    const position = {
      id: nextPositionId,
      marketIndex: activeMarket,
      isLong: side === "long",
      collateral,
      leverage,
      entryPrice: active.price,
      size: collateral * leverage,
    };
    setPositions((items) => [...items, position]);
    setNextPositionId((value) => value + 1);
    setLocked((value) => value + collateral);
    setTicketMessage("Position opened.");
    log(
      `Opened ${position.isLong ? "long" : "short"} ${active.symbol} ${fmt(
        position.size,
        0
      )} at ${fmt(position.entryPrice)}`
    );
  };

  const depositCollateral = () => {
    if (!connected) {
      setTicketMessage("Connect a wallet first.");
      return;
    }
    const amount = Number(cashInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setTicketMessage("Deposit amount must be above zero.");
      return;
    }
    setBalance((value) => value + amount);
    log(`Deposited ${fmt(amount)}`);
  };

  const withdrawCollateral = () => {
    if (!connected) {
      setTicketMessage("Connect a wallet first.");
      return;
    }
    const amount = Number(cashInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setTicketMessage("Withdraw amount must be above zero.");
      return;
    }
    if (freeCollateral < amount) {
      setTicketMessage("Insufficient free collateral.");
      return;
    }
    setBalance((value) => value - amount);
    log(`Withdrew ${fmt(amount)}`);
  };

  const collateral = Math.max(Number(collateralInput) || 0, 0);
  const size = collateral * leverage;
  const liquidation = liquidationPrice(
    collateral,
    leverage,
    side === "long",
    active.price
  );

  return (
    <>
      <section
        className="account-strip terminal-account"
        aria-label="Account state"
      >
        <div>
          <span>Wallet</span>
          <strong>{connected ? "RX7b...91df" : "Disconnected"}</strong>
        </div>
        <div>
          <span>Equity</span>
          <strong>{fmt(accountEquity)}</strong>
        </div>
        <div>
          <span>Free</span>
          <strong>{fmt(freeCollateral)}</strong>
        </div>
        <div>
          <span>Reputation</span>
          <strong>{profile.reputationScore}</strong>
        </div>
        <button
          className="primary-action"
          type="button"
          onClick={() => {
            setConnected((value) => !value);
            log(connected ? "Wallet disconnected" : "Wallet connected");
          }}
        >
          {connected ? "Disconnect" : "Connect"}
        </button>
      </section>

      <section className="market-row" aria-label="Market selector">
        <div className="market-tabs">
          {markets.map((market, index) => (
            <button
              className={`market-tab ${index === activeMarket ? "active" : ""}`}
              key={market.symbol}
              type="button"
              onClick={() => setActiveMarket(index)}
            >
              <strong>{market.symbol}</strong>
              <span className={market.change >= 0 ? "up" : "down"}>
                {fmt(market.price)} {pct(market.change)}
              </span>
            </button>
          ))}
        </div>
        <div className="market-stats">
          <Stat label="Mark" value={fmt(active.price)} />
          <Stat
            label="24h"
            value={pct(active.change)}
            tone={active.change >= 0 ? "up" : "down"}
          />
          <Stat
            label="Funding"
            value={`${active.funding >= 0 ? "+" : ""}${active.funding.toFixed(
              3
            )}%`}
            tone={active.funding >= 0 ? "up" : "down"}
          />
          <Stat
            label="Open interest"
            value={fmt(openInterestFor(activeMarket), 0)}
          />
        </div>
      </section>

      <section className="workspace">
        <section className="chart-panel" aria-label="Price chart">
          <div className="panel-heading">
            <h2>{active.symbol}</h2>
            <div
              className="segmented"
              role="group"
              aria-label="Chart timeframe"
            >
              {["1m", "5m", "1h"].map((item) => (
                <button
                  className={`segment ${timeframe === item ? "active" : ""}`}
                  key={item}
                  type="button"
                  onClick={() => setTimeframe(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <PriceChart
            points={history[activeMarket]}
            positive={active.change >= 0}
          />
          <div className="trade-tape">
            {history[activeMarket]
              .slice(-5)
              .reverse()
              .map((price, index, list) => {
                const previous = list[index + 1] ?? price;
                const up = price >= previous;
                return (
                  <div className="tape-print" key={`${price}-${index}`}>
                    <strong className={up ? "up" : "down"}>{fmt(price)}</strong>
                    <span>
                      {up ? "Buy" : "Sell"} {active.base}
                    </span>
                  </div>
                );
              })}
          </div>
        </section>

        <OrderBook market={active} />

        <aside className="ticket-panel" aria-label="Order ticket">
          <div className="side-toggle" role="group" aria-label="Trade side">
            <button
              className={`long ${side === "long" ? "active" : ""}`}
              type="button"
              onClick={() => setSide("long")}
            >
              Long
            </button>
            <button
              className={`short ${side === "short" ? "active" : ""}`}
              type="button"
              onClick={() => setSide("short")}
            >
              Short
            </button>
          </div>
          <label>
            Collateral
            <input
              min="1"
              step="1"
              type="number"
              value={collateralInput}
              onChange={(event) => setCollateralInput(event.target.value)}
            />
          </label>
          <label>
            Leverage
            <input
              max={maxLeverage}
              min="1"
              step="1"
              type="range"
              value={leverage}
              onChange={(event) => setLeverageInput(event.target.value)}
            />
            <span>
              {leverage}x max {maxLeverage}x
            </span>
          </label>
          <div className="ticket-preview">
            <Preview label="Size" value={fmt(size)} />
            <Preview label="Entry" value={fmt(active.price)} />
            <Preview label="Liq. price" value={fmt(liquidation)} />
            <Preview
              label="Maintenance"
              value={fmt((size * MAINTENANCE_MARGIN_BPS) / BASIS_POINTS)}
            />
          </div>
          <button className="submit-order" type="button" onClick={openPosition}>
            Open {side === "long" ? "Long" : "Short"}
          </button>
          <p className="ticket-message" role="status">
            {ticketMessage}
          </p>
        </aside>

        <Portfolio
          balance={balance}
          closePosition={closePosition}
          locked={locked}
          markets={markets}
          positions={positions}
          profile={profile}
          positionPnl={positionPnl}
          maintenanceMargin={maintenanceMargin}
          positionEquity={positionEquity}
          cashInput={cashInput}
          setCashInput={setCashInput}
          depositCollateral={depositCollateral}
          withdrawCollateral={withdrawCollateral}
        />
        <ProfilePanel activity={activity} profile={profile} />
      </section>
    </>
  );
}

function liquidationPrice(collateral, leverage, isLong, entryPrice) {
  const size = collateral * leverage;
  const maintenance = (size * MAINTENANCE_MARGIN_BPS) / BASIS_POINTS;
  const lossToMaintenance = collateral - maintenance;
  const priceMove = size > 0 ? (lossToMaintenance * entryPrice) / size : 0;
  return isLong ? Math.max(entryPrice - priceMove, 0) : entryPrice + priceMove;
}

function Stat({ label, value, tone }) {
  return (
    <div>
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function Preview({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PriceChart({ points, positive }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * ratio);
    canvas.height = Math.floor(rect.height * ratio);
    ctx.scale(ratio, ratio);

    const width = rect.width;
    const height = rect.height;
    const pad = 28;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min || 1;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0b1016";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#1f2a35";
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i += 1) {
      const y = pad + ((height - pad * 2) / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.beginPath();
    points.forEach((point, index) => {
      const x = pad + (index / (points.length - 1)) * (width - pad * 2);
      const y = height - pad - ((point - min) / span) * (height - pad * 2);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = positive ? "#20c997" : "#ff5b6e";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = "#8c9aa7";
    ctx.font = "12px system-ui";
    ctx.fillText(fmt(max), width - 92, 18);
    ctx.fillText(fmt(min), width - 92, height - 10);
  }, [points, positive]);

  return <canvas id="priceChart" ref={canvasRef} width="920" height="420" />;
}

function OrderBook({ market }) {
  const levels = useMemo(
    () =>
      Array.from({ length: 9 }, (_, index) => ({
        bps: (index + 1) * 4,
        size: 3000 + Math.round(Math.random() * 18000),
      })),
    [market.price]
  );
  const maxSize = Math.max(...levels.map((level) => level.size));
  const row = (level, side) => (
    <div
      className="book-row"
      key={`${side}-${level.bps}`}
      style={{ "--depth": `${Math.round((level.size / maxSize) * 92)}%` }}
    >
      <span>
        {fmt(
          market.price *
            (1 + ((side === "ask" ? 1 : -1) * level.bps) / BASIS_POINTS)
        )}
      </span>
      <span>{fmt(level.size, 0)}</span>
    </div>
  );

  return (
    <aside className="book-panel" aria-label="Order book">
      <div className="panel-heading compact">
        <h2>Book</h2>
        <span>8.00 bps</span>
      </div>
      <div className="book-grid">
        <div className="book-side asks">
          {levels
            .slice()
            .reverse()
            .map((level) => row(level, "ask"))}
        </div>
        <div className="book-mid">{fmt(market.price)}</div>
        <div className="book-side bids">
          {levels.map((level) => row(level, "bid"))}
        </div>
      </div>
    </aside>
  );
}

function Portfolio({
  balance,
  cashInput,
  closePosition,
  depositCollateral,
  locked,
  maintenanceMargin,
  markets,
  positionEquity,
  positionPnl,
  positions,
  profile,
  setCashInput,
  withdrawCollateral,
}) {
  const winRate = profile.totalTrades
    ? (profile.winningTrades / profile.totalTrades) * 100
    : 0;

  return (
    <section className="portfolio-panel" aria-label="Portfolio">
      <div className="panel-heading">
        <h2>Portfolio</h2>
        <div className="cash-controls">
          <input
            min="1"
            step="1"
            type="number"
            value={cashInput}
            aria-label="Collateral amount"
            onChange={(event) => setCashInput(event.target.value)}
          />
          <button type="button" onClick={depositCollateral}>
            Deposit
          </button>
          <button type="button" onClick={withdrawCollateral}>
            Withdraw
          </button>
        </div>
      </div>
      <div className="risk-strip">
        <Stat label="Balance" value={fmt(balance)} />
        <Stat label="Locked" value={fmt(locked)} />
        <Stat
          label="Realized PnL"
          value={fmt(profile.realizedPnl)}
          tone={profile.realizedPnl >= 0 ? "up" : "down"}
        />
        <Stat label="Win rate" value={`${winRate.toFixed(1)}%`} />
      </div>
      <div className="positions-table">
        <div className="table-header">
          <span>Market</span>
          <span>Side</span>
          <span>Size</span>
          <span>Entry</span>
          <span>Mark</span>
          <span>PnL</span>
          <span>Health</span>
          <span />
        </div>
        {positions.length === 0 ? (
          <div className="empty-state">No open positions</div>
        ) : (
          positions.map((position) => {
            const market = markets[position.marketIndex];
            const pnl = positionPnl(position);
            const health = clamp(
              (positionEquity(position) / maintenanceMargin(position)) * 100,
              0,
              999
            );
            const healthClass =
              health < 130 ? "down" : health < 220 ? "warn" : "up";
            return (
              <div className="position-row" key={position.id}>
                <strong>{market.symbol}</strong>
                <span className={position.isLong ? "long-text" : "short-text"}>
                  {position.isLong ? "Long" : "Short"} {position.leverage}x
                </span>
                <span>{fmt(position.size)}</span>
                <span>{fmt(position.entryPrice)}</span>
                <span>{fmt(market.price)}</span>
                <strong className={pnl >= 0 ? "up" : "down"}>{fmt(pnl)}</strong>
                <strong className={healthClass}>{health.toFixed(0)}%</strong>
                <button
                  className="position-action"
                  type="button"
                  onClick={() => closePosition(position.id)}
                >
                  Close
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function ProfilePanel({ activity, profile }) {
  return (
    <section className="profile-panel" aria-label="Reputation profile">
      <div className="panel-heading">
        <h2>Reputation</h2>
        <strong>{profile.reputationScore}</strong>
      </div>
      <div className="score-meter">
        <span
          style={{ width: `${clamp(profile.reputationScore, 0, 180) / 1.8}%` }}
        />
      </div>
      <div className="profile-grid">
        <Stat label="Trades" value={profile.totalTrades} />
        <Stat label="Wins" value={profile.winningTrades} />
        <Stat label="Losses" value={profile.losingTrades} />
        <Stat label="Liquidations" value={profile.liquidations} />
        <Stat label="Volume" value={fmt(profile.totalVolume, 0)} />
        <Stat
          label="Avg. lev."
          value={`${(profile.avgLeverageX100 / 100).toFixed(2)}x`}
        />
      </div>
      <div className="activity-log">
        {activity.map((entry, index) => (
          <div className="log-entry" key={`${entry}-${index}`}>
            {entry}
          </div>
        ))}
      </div>
    </section>
  );
}

function LiveDevnetConsole() {
  const [wallet, setWallet] = useState(null);
  const [program, setProgram] = useState(null);
  const [provider, setProvider] = useState(null);
  const [form, setForm] = useState({
    rpcUrl: "https://api.devnet.solana.com",
    programId: "5NEGduu9b3fKDokVzDRHPQcxCoLnFbQpWBtDjugoNqhy",
    idlPath: "/program/target/idl/reputex.json",
    ownerTokenAccount: "",
    marketIndex: 0,
    positionId: 0,
    amount: 100,
    leverage: 2,
    side: "long",
  });
  const [stateOutput, setStateOutput] = useState("Load the program to begin.");
  const [logs, setLogs] = useState([]);

  const log = (message) => {
    const stamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    setLogs((entries) => [`${stamp} - ${message}`, ...entries].slice(0, 12));
  };
  const setField = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));

  const connectWallet = async () => {
    if (!window.solana?.isPhantom) throw new Error("Phantom wallet not found");
    const response = await window.solana.connect();
    setWallet(window.solana);
    log(`Wallet connected ${response.publicKey.toBase58()}`);
    return window.solana;
  };

  const loadProgram = async () => {
    const connectedWallet = wallet ?? (await connectWallet());
    const connection = new Connection(form.rpcUrl, "confirmed");
    const nextProvider = new anchor.AnchorProvider(
      connection,
      connectedWallet,
      {
        commitment: "confirmed",
      }
    );
    const idl = await fetch(form.idlPath).then((response) => response.json());
    idl.address = form.programId;
    const nextProgram = new anchor.Program(idl, nextProvider);
    setProvider(nextProvider);
    setProgram(nextProgram);
    log(`Loaded program ${nextProgram.programId.toBase58()}`);
    await refreshState(nextProgram, connectedWallet);
  };

  const derivePdas = (targetProgram = program, targetWallet = wallet) => {
    const owner = targetWallet.publicKey;
    const marketIndex = Number(form.marketIndex);
    const positionId = Number(form.positionId);
    const [protocol] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("protocol")],
      targetProgram.programId
    );
    const [collateralVault] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("vault")],
      targetProgram.programId
    );
    const [market] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("market"), u64Le(marketIndex)],
      targetProgram.programId
    );
    const [traderProfile] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("trader"), owner.toBuffer()],
      targetProgram.programId
    );
    const [marginAccount] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("margin"), owner.toBuffer()],
      targetProgram.programId
    );
    const [position] = PublicKey.findProgramAddressSync(
      [
        new TextEncoder().encode("position"),
        owner.toBuffer(),
        u64Le(positionId),
      ],
      targetProgram.programId
    );
    return {
      protocol,
      collateralVault,
      market,
      traderProfile,
      marginAccount,
      position,
      owner,
    };
  };

  const refreshState = async (
    targetProgram = program,
    targetWallet = wallet
  ) => {
    if (!targetProgram || !targetWallet)
      throw new Error("Load the program first");
    const accounts = derivePdas(targetProgram, targetWallet);
    const output = {};
    for (const [name, pubkey] of Object.entries(accounts)) {
      output[`${name}Pda`] = pubkey.toBase58();
    }
    for (const [name, fetcher] of [
      [
        "protocol",
        () => targetProgram.account.protocol.fetch(accounts.protocol),
      ],
      ["market", () => targetProgram.account.market.fetch(accounts.market)],
      [
        "profile",
        () => targetProgram.account.traderProfile.fetch(accounts.traderProfile),
      ],
      [
        "margin",
        () => targetProgram.account.marginAccount.fetch(accounts.marginAccount),
      ],
    ]) {
      try {
        output[name] = await fetcher();
      } catch {
        output[name] = "not initialized";
      }
    }
    setStateOutput(JSON.stringify(output, null, 2));
  };

  const send = async (label, builder) => {
    if (!program || !provider) throw new Error("Load the program first");
    const signature = await builder().rpc();
    log(`${label}: ${signature}`);
    await refreshState();
  };

  const liveAmount = () => new anchor.BN(Number(form.amount));
  const livePositionId = () => new anchor.BN(Number(form.positionId));
  const liveMarketIndex = () => new anchor.BN(Number(form.marketIndex));

  return (
    <section className="live-grid">
      <section className="live-panel" aria-label="Live controls">
        <h2>Transaction Console</h2>
        <LiveInput
          label="RPC URL"
          value={form.rpcUrl}
          onChange={(value) => setField("rpcUrl", value)}
        />
        <LiveInput
          label="Program ID"
          value={form.programId}
          onChange={(value) => setField("programId", value)}
        />
        <LiveInput
          label="IDL path"
          value={form.idlPath}
          onChange={(value) => setField("idlPath", value)}
        />
        <LiveInput
          label="Owner token account"
          value={form.ownerTokenAccount}
          onChange={(value) => setField("ownerTokenAccount", value)}
          placeholder="SPL collateral token account"
        />
        <LiveInput
          label="Market index"
          type="number"
          value={form.marketIndex}
          onChange={(value) => setField("marketIndex", value)}
        />
        <LiveInput
          label="Position ID"
          type="number"
          value={form.positionId}
          onChange={(value) => setField("positionId", value)}
        />
        <LiveInput
          label="Amount / collateral"
          type="number"
          value={form.amount}
          onChange={(value) => setField("amount", value)}
        />
        <LiveInput
          label="Leverage"
          type="number"
          value={form.leverage}
          onChange={(value) => setField("leverage", value)}
        />
        <label>
          Side
          <select
            value={form.side}
            onChange={(event) => setField("side", event.target.value)}
          >
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </label>
        <div className="live-actions">
          <button
            className="primary-action"
            type="button"
            onClick={() => loadProgram().catch((error) => log(error.message))}
          >
            Load
          </button>
          <button
            type="button"
            onClick={() => refreshState().catch((error) => log(error.message))}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() =>
              send("create profile", () => {
                const a = derivePdas();
                return program.methods.createTraderProfile().accountsStrict({
                  protocol: a.protocol,
                  traderProfile: a.traderProfile,
                  marginAccount: a.marginAccount,
                  owner: a.owner,
                  systemProgram: SystemProgram.programId,
                });
              }).catch((error) => log(error.message))
            }
          >
            Create Profile
          </button>
          <button
            type="button"
            onClick={() =>
              send("deposit", () => {
                const a = derivePdas();
                return program.methods
                  .depositCollateral(liveAmount())
                  .accountsStrict({
                    protocol: a.protocol,
                    marginAccount: a.marginAccount,
                    collateralVault: a.collateralVault,
                    ownerTokenAccount: new PublicKey(form.ownerTokenAccount),
                    owner: a.owner,
                    tokenProgram: TOKEN_PROGRAM_ID,
                  });
              }).catch((error) => log(error.message))
            }
          >
            Deposit
          </button>
          <button
            type="button"
            onClick={() =>
              send("withdraw", () => {
                const a = derivePdas();
                return program.methods
                  .withdrawCollateral(liveAmount())
                  .accountsStrict({
                    protocol: a.protocol,
                    marginAccount: a.marginAccount,
                    collateralVault: a.collateralVault,
                    ownerTokenAccount: new PublicKey(form.ownerTokenAccount),
                    owner: a.owner,
                    tokenProgram: TOKEN_PROGRAM_ID,
                  });
              }).catch((error) => log(error.message))
            }
          >
            Withdraw
          </button>
          <button
            type="button"
            onClick={() =>
              send("open position", () => {
                const a = derivePdas();
                return program.methods
                  .openPosition(
                    livePositionId(),
                    liveMarketIndex(),
                    form.side === "long",
                    liveAmount(),
                    Number(form.leverage)
                  )
                  .accountsStrict({
                    protocol: a.protocol,
                    market: a.market,
                    traderProfile: a.traderProfile,
                    marginAccount: a.marginAccount,
                    position: a.position,
                    owner: a.owner,
                    systemProgram: SystemProgram.programId,
                  });
              }).catch((error) => log(error.message))
            }
          >
            Open
          </button>
          <button
            type="button"
            onClick={() =>
              send("close position", () => {
                const a = derivePdas();
                return program.methods
                  .closePosition(livePositionId(), liveMarketIndex())
                  .accountsStrict({
                    protocol: a.protocol,
                    market: a.market,
                    traderProfile: a.traderProfile,
                    marginAccount: a.marginAccount,
                    position: a.position,
                    owner: a.owner,
                  });
              }).catch((error) => log(error.message))
            }
          >
            Close
          </button>
        </div>
      </section>

      <section className="live-panel" aria-label="Live state">
        <h2>State</h2>
        <div className="live-state">{stateOutput}</div>
        <h2 className="live-log-title">Log</h2>
        <div className="live-log">
          {logs.map((entry, index) => (
            <div key={`${entry}-${index}`}>{entry}</div>
          ))}
        </div>
      </section>
    </section>
  );
}

function LiveInput({ label, onChange, placeholder, type = "text", value }) {
  return (
    <label>
      {label}
      <input
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export default App;
