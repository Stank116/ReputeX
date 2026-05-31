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
  const [orderType, setOrderType] = useState("market");
  const [limitPriceInput, setLimitPriceInput] = useState("");
  const [triggerPriceInput, setTriggerPriceInput] = useState("");
  const [pendingOrders, setPendingOrders] = useState([]);
  const [notifications, setNotifications] = useState([]);
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
  const pendingCollateral = pendingOrders.reduce((sum, order) => sum + order.collateral, 0);
  const freeCollateral = Math.max(balance - locked - pendingCollateral, 0);
  const unrealizedPnl = positions.reduce((sum, position) => sum + positionPnl(position), 0);
  const accountEquity = balance + unrealizedPnl;

  const log = (message) => {
    const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setActivity((entries) => [`${stamp} - ${message}`, ...entries].slice(0, 8));
  };

  const notify = (message, tone = "info") => {
    const id = `${Date.now()}-${Math.random()}`;
    setNotifications((items) => [{ id, message, tone }, ...items].slice(0, 4));
    window.setTimeout(() => {
      setNotifications((items) => items.filter((item) => item.id !== id));
    }, 4200);
  };

  const closePosition = (id, liquidated = false, marketList = markets, closeRatio = 1) => {
    setPositions((current) => {
      const position = current.find((item) => item.id === id);
      if (!position) return current;
      const ratio = clamp(closeRatio, 0.01, 1);
      const pnl = positionPnl(position, marketList) * ratio;
      const collateralClosed = position.collateral * ratio;
      const sizeClosed = position.size * ratio;
      setLocked((value) => Math.max(value - collateralClosed, 0));
      setBalance((value) => (liquidated ? Math.max(value - collateralClosed, 0) : Math.max(value + pnl, 0)));
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
          totalVolume: oldProfile.totalVolume + sizeClosed,
          realizedPnl: oldProfile.realizedPnl + pnl,
          avgLeverageX100,
        };
        return { ...updated, reputationScore: calculateReputation(updated) };
      });
      log(
        `${liquidated ? "Liquidated" : ratio < 1 ? "Reduced" : "Closed"} ${marketList[position.marketIndex].symbol} ${
          pnl >= 0 ? "+" : ""
        }${fmt(pnl)}`
      );
      notify(`${liquidated ? "Liquidated" : ratio < 1 ? "Position reduced" : "Position closed"} ${marketList[position.marketIndex].symbol}`, liquidated ? "danger" : pnl >= 0 ? "success" : "warn");
      if (ratio >= 0.999 || liquidated) return current.filter((item) => item.id !== id);
      return current.map((item) =>
        item.id === id
          ? {
              ...item,
              collateral: item.collateral - collateralClosed,
              size: item.size - sizeClosed,
            }
          : item
      );
    });
  };

  const closePositionPartial = (id, percent) => closePosition(id, false, markets, Number(percent) / 100);

  const addMarginToPosition = (id, amount) => {
    if (!Number.isFinite(amount) || amount <= 0) {
      setTicketMessage("Margin amount must be above zero.");
      notify("Margin amount must be above zero", "warn");
      return;
    }
    if (freeCollateral < amount) {
      setTicketMessage("Insufficient free collateral to add margin.");
      notify("Insufficient free collateral", "warn");
      return;
    }
    setPositions((items) =>
      items.map((position) =>
        position.id === id
          ? {
              ...position,
              collateral: position.collateral + amount,
              leverage: Math.max(1, Number((position.size / (position.collateral + amount)).toFixed(2))),
            }
          : position
      )
    );
    setLocked((value) => value + amount);
    log(`Added ${fmt(amount)} margin to position #${id}`);
    notify(`Added margin to position #${id}`, "success");
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
        const triggeredOrderIds = new Set();
        pendingOrders.forEach((order) => {
          const mark = nextMarkets[order.marketIndex].price;
          const triggered =
            order.type === "limit"
              ? order.isLong
                ? mark <= order.price
                : mark >= order.price
              : order.isLong
                ? mark >= order.price
                : mark <= order.price;
          if (triggered) {
            triggeredOrderIds.add(order.id);
            executeOpenPosition(order, nextMarkets, true);
          }
        });
        setPendingOrders((orders) =>
          orders.filter((order) => {
            if (triggeredOrderIds.has(order.id)) return false;
            const mark = nextMarkets[order.marketIndex].price;
            return order.type === "limit"
              ? order.isLong
                ? mark > order.price
                : mark < order.price
              : order.isLong
                ? mark < order.price
                : mark > order.price;
          })
        );
        positions
          .filter((position) => positionEquity(position, nextMarkets) <= maintenanceMargin(position))
          .forEach((position) => closePosition(position.id, true, nextMarkets));
        return nextMarkets;
      });
    }, 1800);
    return () => clearInterval(timer);
  }, [pendingOrders, positions]);

  const openInterestFor = (index) =>
    positions.filter((position) => position.marketIndex === index).reduce((sum, position) => sum + position.size, 0);

  const executeOpenPosition = (order, marketList = markets, fromTrigger = false) => {
    const selectedMarket = marketList[order.marketIndex];
    const reservedByOtherOrders = pendingOrders
      .filter((item) => item.id !== order.id)
      .reduce((sum, item) => sum + item.collateral, 0);
    const executableFreeCollateral = Math.max(balance - locked - reservedByOtherOrders, 0);
    if (executableFreeCollateral < order.collateral) {
      setTicketMessage("Order skipped because free collateral changed.");
      notify("Order skipped: insufficient free collateral", "warn");
      return;
    }
    const position = {
      id: order.positionId,
      marketIndex: order.marketIndex,
      isLong: order.isLong,
      collateral: order.collateral,
      leverage: order.leverage,
      entryPrice: selectedMarket.price,
      size: order.collateral * order.leverage,
    };
    setPositions((items) => [...items, position]);
    if (!fromTrigger) setNextPositionId((value) => value + 1);
    setLocked((value) => value + order.collateral);
    setTicketMessage(fromTrigger ? "Conditional order filled." : "Position opened.");
    log(`Opened ${position.isLong ? "long" : "short"} ${selectedMarket.symbol} ${fmt(position.size, 0)} at ${fmt(position.entryPrice)}`);
    notify(`${fromTrigger ? "Conditional filled" : "Position opened"} ${selectedMarket.symbol}`, "success");
  };

  const openPosition = () => {
    if (!connected) {
      setTicketMessage("Connect the demo session first.");
      notify("Connect the demo session first", "warn");
      return;
    }
    const collateral = Number(collateralInput);
    if (!Number.isFinite(collateral) || collateral <= 0) {
      setTicketMessage("Collateral must be above zero.");
      notify("Collateral must be above zero", "warn");
      return;
    }
    if (leverage < 1 || leverage > maxLeverage) {
      setTicketMessage(`Current reputation allows up to ${maxLeverage}x.`);
      notify(`Current reputation allows up to ${maxLeverage}x`, "warn");
      return;
    }
    if (freeCollateral < collateral) {
      setTicketMessage("Insufficient free collateral.");
      notify("Insufficient free collateral", "warn");
      return;
    }

    const order = {
      id: `${Date.now()}-${nextPositionId}`,
      positionId: nextPositionId,
      type: orderType,
      marketIndex: activeMarket,
      isLong: side === "long",
      collateral,
      leverage,
      price: orderType === "limit" ? Number(limitPriceInput) : Number(triggerPriceInput),
    };

    if (orderType === "market") {
      executeOpenPosition(order);
      return;
    }

    if (!Number.isFinite(order.price) || order.price <= 0) {
      setTicketMessage("Conditional orders need a valid price.");
      notify("Conditional orders need a valid price", "warn");
      return;
    }

    if (order.type === "limit") {
      const crossesBook = order.isLong ? order.price >= active.price : order.price <= active.price;
      if (crossesBook) {
        setTicketMessage("Limit price would execute immediately. Use Market or pick a passive price.");
        notify("Limit price crosses the current mark", "warn");
        return;
      }
    }

    if (order.type === "stop") {
      const invalidStop = order.isLong ? order.price <= active.price : order.price >= active.price;
      if (invalidStop) {
        setTicketMessage("Stop trigger must be above mark for longs and below mark for shorts.");
        notify("Stop trigger is on the wrong side of mark", "warn");
        return;
      }
    }

    setPendingOrders((orders) => [order, ...orders].slice(0, 8));
    setNextPositionId((value) => value + 1);
    setTicketMessage(`${orderType === "limit" ? "Limit" : "Stop"} order placed.`);
    log(`Placed ${orderType} ${side} ${active.symbol} trigger ${fmt(order.price)}`);
    notify(`${orderType === "limit" ? "Limit" : "Stop"} order placed`, "info");
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
    notify(`Deposited ${fmt(amount)}`, "success");
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
      notify("Insufficient free collateral", "warn");
      return;
    }
    setBalance((value) => value - amount);
    log(`Withdrew ${fmt(amount)}`);
    notify(`Withdrew ${fmt(amount)}`, "success");
  };

  const collateral = Math.max(Number(collateralInput) || 0, 0);
  const size = collateral * leverage;
  const liquidation = liquidationPrice(collateral, leverage, side === "long", active.price);
  const marginUsage = accountEquity > 0 ? clamp((locked / accountEquity) * 100, 0, 100) : 0;
  const liquidationDistance = active.price > 0 ? Math.abs((active.price - liquidation) / active.price) * 100 : 0;
  const estimatedFee = size * 0.0005;
  const activePendingOrders = pendingOrders.filter((order) => order.marketIndex === activeMarket);

  return (
    <>
      <div className="toast-stack" aria-live="polite">
        {notifications.map((item) => (
          <div className={`toast ${item.tone}`} key={item.id}>
            {item.message}
          </div>
        ))}
      </div>
      <section className="account-strip terminal-account" aria-label="Account state">
        <Stat label="Session" value={connected ? "Demo wallet" : "Disconnected"} />
        <Stat label="Equity" value={fmt(accountEquity)} />
        <Stat label="Free" value={fmt(freeCollateral)} />
        <Stat label="Margin used" value={`${marginUsage.toFixed(1)}%`} tone={marginUsage > 70 ? "warn" : "up"} />
        <Stat label="Reserved" value={fmt(pendingCollateral)} tone={pendingCollateral > 0 ? "warn" : undefined} />
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
          <div className="order-type-tabs" role="group" aria-label="Order type">
            {[
              ["market", "Market"],
              ["limit", "Limit"],
              ["stop", "Stop"],
            ].map(([value, label]) => (
              <button className={orderType === value ? "active" : ""} key={value} type="button" onClick={() => setOrderType(value)}>
                {label}
              </button>
            ))}
          </div>
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
          {orderType === "limit" ? (
            <label>
              Limit price
              <input
                min="0.01"
                step="0.01"
                type="number"
                placeholder={active.price.toFixed(2)}
                value={limitPriceInput}
                onChange={(event) => setLimitPriceInput(event.target.value)}
              />
            </label>
          ) : null}
          {orderType === "stop" ? (
            <label>
              Stop trigger
              <input
                min="0.01"
                step="0.01"
                type="number"
                placeholder={side === "long" ? (active.price * 1.01).toFixed(2) : (active.price * 0.99).toFixed(2)}
                value={triggerPriceInput}
                onChange={(event) => setTriggerPriceInput(event.target.value)}
              />
            </label>
          ) : null}
          <div className="ticket-preview">
            <Preview label="Size" value={fmt(size)} />
            <Preview label="Entry" value={fmt(active.price)} />
            <Preview label="Liq. price" value={fmt(liquidation)} />
            <Preview label="Liq. gap" value={`${liquidationDistance.toFixed(1)}%`} tone={liquidationDistance < 8 ? "down" : liquidationDistance < 18 ? "warn" : "up"} />
            <Preview label="Maintenance" value={fmt((size * MAINTENANCE_MARGIN_BPS) / BASIS_POINTS)} />
            <Preview label="Est. fee" value={fmt(estimatedFee)} />
          </div>
          <div className="risk-meter" aria-label="Liquidation risk meter">
            <span style={{ "--risk": `${clamp(liquidationDistance * 4, 3, 100)}%` }} />
          </div>
          <button className="submit-order" type="button" onClick={openPosition}>
            {orderType === "market" ? "Open" : "Place"} {side === "long" ? "Long" : "Short"}
          </button>
          <p className="ticket-message" role="status">
            {ticketMessage}
          </p>
          {activePendingOrders.length ? (
            <div className="pending-orders">
              <strong>Pending orders</strong>
              {activePendingOrders.map((order) => (
                <div key={order.id}>
                  <span>
                    {order.type} {order.isLong ? "long" : "short"}
                  </span>
                  <button type="button" onClick={() => setPendingOrders((orders) => orders.filter((item) => item.id !== order.id))}>
                    Cancel {fmt(order.price)}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </aside>

        <Portfolio
          addMarginToPosition={addMarginToPosition}
          balance={balance}
          closePosition={closePosition}
          closePositionPartial={closePositionPartial}
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
