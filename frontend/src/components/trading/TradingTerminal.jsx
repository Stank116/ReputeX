import { useEffect, useState } from "react";

import { markets as initialMarkets, startingProfile } from "../../config/markets";
import { clamp, fmt, pct } from "../../lib/format";
import {
  BASIS_POINTS,
  MAINTENANCE_MARGIN_BPS,
  calculateReputation,
  liquidationPrice,
  reputationLeverageCap,
  seedHistory,
} from "../../lib/perps";
import { Preview, Stat } from "../shared/Stat";
import { OrderBook } from "./OrderBook";
import { Portfolio } from "./Portfolio";
import { PriceChart } from "./PriceChart";
import { ProfilePanel } from "./ProfilePanel";

export function TradingTerminal() {
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
  const maxLeverage = reputationLeverageCap(profile.reputationScore, active.maxLev);
  const leverage = Math.min(Number(leverageInput) || 1, maxLeverage);

  const positionPnl = (position, marketList = markets) => {
    const mark = marketList[position.marketIndex].price;
    const delta = position.isLong ? mark - position.entryPrice : position.entryPrice - mark;
    return (delta * position.size) / position.entryPrice;
  };
  const maintenanceMargin = (position) => (position.size * MAINTENANCE_MARGIN_BPS) / BASIS_POINTS;
  const positionEquity = (position, marketList = markets) => position.collateral + positionPnl(position, marketList);
  const freeCollateral = Math.max(balance - locked, 0);
  const unrealizedPnl = positions.reduce((sum, position) => sum + positionPnl(position), 0);
  const accountEquity = balance + unrealizedPnl;

  const log = (message) => {
    const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setActivity((entries) => [`${stamp} - ${message}`, ...entries].slice(0, 8));
  };

  const closePosition = (id, liquidated = false, marketList = markets) => {
    setPositions((current) => {
      const position = current.find((item) => item.id === id);
      if (!position) return current;
      const pnl = positionPnl(position, marketList);
      setLocked((value) => Math.max(value - position.collateral, 0));
      setBalance((value) => (liquidated ? Math.max(value - position.collateral, 0) : Math.max(value + pnl, 0)));
      setProfile((oldProfile) => {
        const totalTrades = oldProfile.totalTrades + 1;
        const newLeverage = position.leverage * 100;
        const avgLeverageX100 =
          oldProfile.totalTrades === 0
            ? newLeverage
            : Math.floor((oldProfile.avgLeverageX100 * oldProfile.totalTrades + newLeverage) / totalTrades);
        const updated = {
          ...oldProfile,
          totalTrades,
          winningTrades: pnl > 0 && !liquidated ? oldProfile.winningTrades + 1 : oldProfile.winningTrades,
          losingTrades: pnl <= 0 || liquidated ? oldProfile.losingTrades + 1 : oldProfile.losingTrades,
          liquidations: liquidated ? oldProfile.liquidations + 1 : oldProfile.liquidations,
          totalVolume: oldProfile.totalVolume + position.size,
          realizedPnl: oldProfile.realizedPnl + pnl,
          avgLeverageX100,
        };
        return { ...updated, reputationScore: calculateReputation(updated) };
      });
      log(
        `${liquidated ? "Liquidated" : "Closed"} ${marketList[position.marketIndex].symbol} ${
          pnl >= 0 ? "+" : ""
        }${fmt(pnl)}`
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
          const price = Math.max(market.price * (1 + bias + wave + impulse), 0.01);
          return { ...market, price, change: market.change * 0.985 + (bias + impulse) * 120 };
        });
        setHistory((oldHistory) =>
          oldHistory.map((points, index) => {
            const updated = [...points, nextMarkets[index].price];
            return updated.length > 90 ? updated.slice(1) : updated;
          })
        );
        positions
          .filter((position) => positionEquity(position, nextMarkets) <= maintenanceMargin(position))
          .forEach((position) => closePosition(position.id, true, nextMarkets));
        return nextMarkets;
      });
    }, 1800);
    return () => clearInterval(timer);
  }, [positions]);

  const openInterestFor = (index) =>
    positions.filter((position) => position.marketIndex === index).reduce((sum, position) => sum + position.size, 0);

  const openPosition = () => {
    if (!connected) {
      setTicketMessage("Connect the demo session first.");
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
    log(`Opened ${position.isLong ? "long" : "short"} ${active.symbol} ${fmt(position.size, 0)} at ${fmt(position.entryPrice)}`);
  };

  const depositCollateral = () => {
    if (!connected) {
      setTicketMessage("Connect the demo session first.");
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
      setTicketMessage("Connect the demo session first.");
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
  const liquidation = liquidationPrice(collateral, leverage, side === "long", active.price);
  const marginUsage = accountEquity > 0 ? clamp((locked / accountEquity) * 100, 0, 100) : 0;

  return (
    <>
      <section className="account-strip terminal-account" aria-label="Account state">
        <Stat label="Session" value={connected ? "Demo wallet" : "Disconnected"} />
        <Stat label="Equity" value={fmt(accountEquity)} />
        <Stat label="Free" value={fmt(freeCollateral)} />
        <Stat label="Margin used" value={`${marginUsage.toFixed(1)}%`} tone={marginUsage > 70 ? "warn" : "up"} />
        <Stat label="Reputation" value={profile.reputationScore} />
        <button
          className="primary-action"
          type="button"
          onClick={() => {
            setConnected((value) => !value);
            log(connected ? "Demo wallet disconnected" : "Demo wallet connected");
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
          <Stat label="24h" value={pct(active.change)} tone={active.change >= 0 ? "up" : "down"} />
          <Stat
            label="Funding"
            value={`${active.funding >= 0 ? "+" : ""}${active.funding.toFixed(3)}%`}
            tone={active.funding >= 0 ? "up" : "down"}
          />
          <Stat label="Open interest" value={fmt(openInterestFor(activeMarket), 0)} />
          <Stat label="Oracle" value={active.oracle} />
        </div>
      </section>

      <section className="workspace">
        <section className="chart-panel" aria-label="Price chart">
          <div className="panel-heading">
            <h2>{active.symbol}</h2>
            <div className="segmented" role="group" aria-label="Chart timeframe">
              {["1m", "5m", "1h"].map((item) => (
                <button className={`segment ${timeframe === item ? "active" : ""}`} key={item} type="button" onClick={() => setTimeframe(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>
          <PriceChart points={history[activeMarket]} positive={active.change >= 0} />
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
            <button className={`long ${side === "long" ? "active" : ""}`} type="button" onClick={() => setSide("long")}>
              Long
            </button>
            <button className={`short ${side === "short" ? "active" : ""}`} type="button" onClick={() => setSide("short")}>
              Short
            </button>
          </div>
          <label>
            Collateral
            <input min="1" step="1" type="number" value={collateralInput} onChange={(event) => setCollateralInput(event.target.value)} />
          </label>
          <label>
            Leverage
            <input max={maxLeverage} min="1" step="1" type="range" value={leverage} onChange={(event) => setLeverageInput(event.target.value)} />
            <span>
              {leverage}x max {maxLeverage}x
            </span>
          </label>
          <div className="ticket-preview">
            <Preview label="Size" value={fmt(size)} />
            <Preview label="Entry" value={fmt(active.price)} />
            <Preview label="Liq. price" value={fmt(liquidation)} />
            <Preview label="Maintenance" value={fmt((size * MAINTENANCE_MARGIN_BPS) / BASIS_POINTS)} />
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
