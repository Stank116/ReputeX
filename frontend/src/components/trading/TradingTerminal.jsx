import { useEffect, useState } from "react";

import { markets as initialMarkets, startingProfile } from "../../config/markets";
import { useLiveTrading } from "../../hooks/useLiveTrading";
import { useMarketData } from "../../hooks/useMarketData";
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

const chartFrames = ["1m", "5m", "15m", "1h", "4h", "1d"];
const leveragePresets = [1, 2, 3, 4, 5];
const sizingPresets = [25, 50, 75, 100];
const accountNumber = (value, fallback = 0) => Number(value?.toString?.() ?? value ?? fallback);
const displayPrice = (market) => {
  if (!market) return 0;
  const raw = accountNumber(market.price);
  const explicitDecimals = accountNumber(market.priceDecimals);
  const inferredDecimals = explicitDecimals || (raw >= 1_000_000 ? 6 : 0);
  return raw / 10 ** inferredDecimals;
};

function MiniSparkline({ points, positive }) {
  const width = 132;
  const height = 34;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - ((point - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Oracle price sparkline">
      <path className={positive ? "up-stroke" : "down-stroke"} d={path} />
    </svg>
  );
}

export function TradingTerminal({ viewMode = "trade" }) {
  const live = useLiveTrading();
  const marketData = useMarketData();
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
  const marketQuote = marketData.quotes[active.symbol];
  const protocolMarkPrice = activeMarket === 0 && live.market ? displayPrice(live.market) : null;
  const displayActive = {
    ...active,
    price: marketQuote?.price ?? protocolMarkPrice ?? active.price,
    change: marketQuote?.change24h ?? active.change,
    maxLev: live.market ? accountNumber(live.market.maxLeverage, active.maxLev) : active.maxLev,
    funding: live.market ? accountNumber(live.market.cumulativeFundingRateBps) / 100 : active.funding,
    oracle: marketQuote?.source ?? (live.market?.oracleEnabled ? "Pyth devnet" : active.oracle),
  };
  const liveProfile = live.profile
    ? {
        totalTrades: accountNumber(live.profile.totalTrades),
        winningTrades: accountNumber(live.profile.winningTrades),
        losingTrades: accountNumber(live.profile.losingTrades),
        liquidations: accountNumber(live.profile.liquidations),
        totalVolume: accountNumber(live.profile.totalVolume),
        realizedPnl: accountNumber(live.profile.realizedPnl),
        avgLeverageX100: accountNumber(live.profile.avgLeverageX100),
        reputationScore: accountNumber(live.profile.reputationScore, 100),
      }
    : null;
  const activeProfile = liveProfile ?? profile;
  const maxLeverage = reputationLeverageCap(activeProfile.reputationScore, displayActive.maxLev);
  const leverage = Math.min(Number(leverageInput) || 1, maxLeverage);
  const priceForMarket = (index, marketList = markets) =>
    marketData.quotes[initialMarkets[index]?.symbol]?.price ??
    (index === 0 && protocolMarkPrice ? protocolMarkPrice : marketList[index]?.price ?? 0);

  const positionPnl = (position, marketList = markets) => {
    const mark = priceForMarket(position.marketIndex, marketList);
    const delta = position.isLong ? mark - position.entryPrice : position.entryPrice - mark;
    return (delta * position.size) / position.entryPrice;
  };
  const maintenanceMargin = (position) => (position.size * MAINTENANCE_MARGIN_BPS) / BASIS_POINTS;
  const positionEquity = (position, marketList = markets) => position.collateral + positionPnl(position, marketList);
  const pendingCollateral = pendingOrders.reduce((sum, order) => sum + order.collateral, 0);
  const freeCollateral = Math.max(balance - locked - pendingCollateral, 0);
  const unrealizedPnl = positions.reduce((sum, position) => sum + positionPnl(position), 0);
  const accountEquity = balance + unrealizedPnl;
  const liveBalance = live.marginAccount ? accountNumber(live.marginAccount.collateralBalance) : 0;
  const liveLocked = live.marginAccount ? accountNumber(live.marginAccount.lockedCollateral) : 0;
  const liveFreeCollateral = Math.max(liveBalance - liveLocked, 0);
  const livePositions = live.positions.map((position) => ({
    id: accountNumber(position.positionId),
    marketIndex: accountNumber(position.marketIndex),
    isLong: Boolean(position.isLong),
    collateral: accountNumber(position.collateralAmount),
    leverage: accountNumber(position.leverage),
    entryPrice: live.market ? displayPrice({ ...live.market, price: position.entryPrice }) : accountNumber(position.entryPrice),
    size: accountNumber(position.size),
    live: true,
  }));
  const isLiveSession = Boolean(live.wallet);
  const visibleBalance = isLiveSession ? liveBalance : balance;
  const visibleLocked = isLiveSession ? liveLocked : locked;
  const visiblePositions = isLiveSession ? livePositions : positions;
  const visibleFreeCollateral = isLiveSession ? liveFreeCollateral : freeCollateral;
  const visibleUnrealizedPnl = isLiveSession ? livePositions.reduce((sum, position) => sum + positionPnl(position), 0) : unrealizedPnl;
  const visibleAccountEquity = visibleBalance + visibleUnrealizedPnl;

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
    if (!live.wallet && !connected) {
      setTicketMessage("Connect Phantom or the demo session first.");
      notify("Connect Phantom first", "warn");
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
    if ((live.wallet ? liveFreeCollateral : freeCollateral) < collateral) {
      setTicketMessage("Insufficient free collateral.");
      notify("Insufficient free collateral", "warn");
      return;
    }

    if (live.wallet) {
      if (orderType !== "market") {
        setTicketMessage("Limit and stop orders are shown in the UI, but your current on-chain program only supports market open/close.");
        notify("On-chain limit orders need backend support", "warn");
        return;
      }
      if (!live.profile || !live.marginAccount) {
        setTicketMessage("Create profile and deposit collateral before trading.");
        notify("Create profile and deposit first", "warn");
        return;
      }
      live
        .openPosition({ amount: collateral, leverage, isLong: side === "long", marketIndex: activeMarket })
        .then(() => {
          setTicketMessage("On-chain position opened.");
          notify("On-chain position opened", "success");
        })
        .catch((error) => {
          setTicketMessage(error.message);
          notify(error.message, "warn");
        });
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
      const crossesBook = order.isLong ? order.price >= displayActive.price : order.price <= displayActive.price;
      if (crossesBook) {
        setTicketMessage("Limit price would execute immediately. Use Market or pick a passive price.");
        notify("Limit price crosses the current mark", "warn");
        return;
      }
    }

    if (order.type === "stop") {
      const invalidStop = order.isLong ? order.price <= displayActive.price : order.price >= displayActive.price;
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
    if (live.wallet) {
      const amount = Number(cashInput);
      if (!Number.isFinite(amount) || amount <= 0) {
        setTicketMessage("Deposit amount must be above zero.");
        return;
      }
      if (!live.ownerTokenAccount) {
        setTicketMessage("Create the collateral token account first.");
        return;
      }
      live
        .deposit(amount)
        .then(() => {
          setTicketMessage("On-chain deposit confirmed.");
          notify("Deposit confirmed", "success");
        })
        .catch((error) => {
          setTicketMessage(error.message);
          notify(error.message, "warn");
        });
      return;
    }
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
    if (live.wallet) {
      const amount = Number(cashInput);
      if (!Number.isFinite(amount) || amount <= 0) {
        setTicketMessage("Withdraw amount must be above zero.");
        return;
      }
      live
        .withdraw(amount)
        .then(() => {
          setTicketMessage("On-chain withdrawal confirmed.");
          notify("Withdrawal confirmed", "success");
        })
        .catch((error) => {
          setTicketMessage(error.message);
          notify(error.message, "warn");
        });
      return;
    }
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
  const liquidation = liquidationPrice(collateral, leverage, side === "long", displayActive.price);
  const marginUsage = visibleAccountEquity > 0 ? clamp((visibleLocked / visibleAccountEquity) * 100, 0, 100) : 0;
  const liquidationDistance = displayActive.price > 0 ? Math.abs((displayActive.price - liquidation) / displayActive.price) * 100 : 0;
  const estimatedFee = size * 0.0005;
  const activePendingOrders = pendingOrders.filter((order) => order.marketIndex === activeMarket);
  const positionMargin = visiblePositions.reduce((sum, position) => sum + position.collateral, 0);
  const marketVolume = marketQuote?.volume24h;
  const marketHigh = marketQuote?.high24h;
  const marketLow = marketQuote?.low24h;
  const marketCap = marketQuote?.marketCap;
  const chartPoints = marketQuote?.sparkline?.length > 4 ? marketQuote.sparkline : history[activeMarket];
  const marketUpdatedAt = marketData.lastUpdated
    ? marketData.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "loading";
  const nextFundingMinutes = 60 - new Date().getMinutes();
  const orderPriceLabel =
    orderType === "market"
      ? fmt(displayActive.price)
      : orderType === "limit"
        ? limitPriceInput || displayActive.price.toFixed(2)
        : triggerPriceInput || (side === "long" ? (displayActive.price * 1.01).toFixed(2) : (displayActive.price * 0.99).toFixed(2));
  const setCollateralByPercent = (percent) => {
    const amount = Math.floor((visibleFreeCollateral * percent) / 100);
    setCollateralInput(amount > 0 ? amount : 0);
  };
  const cancelPendingOrder = (id) => {
    setPendingOrders((orders) => orders.filter((item) => item.id !== id));
    notify("Order cancelled", "info");
  };
  const handleWalletButton = () => {
    const action = live.wallet ? live.disconnectWallet : live.connectWallet;
    action().catch((error) => {
      setTicketMessage(error.message);
      notify(error.message, "warn");
    });
  };
  const handleLoadProgram = () => {
    live.connectAndLoad().catch((error) => {
      setTicketMessage(error.message);
      notify(error.message, "warn");
    });
  };
  const closePortfolioPosition = (id) => {
    const livePosition = livePositions.find((position) => position.id === id);
    if (live.wallet && livePosition) {
      live
        .closePosition({ positionId: id, marketIndex: livePosition.marketIndex })
        .then(() => {
          setTicketMessage("On-chain position closed.");
          notify("Position closed", "success");
        })
        .catch((error) => {
          setTicketMessage(error.message);
          notify(error.message, "warn");
        });
      return;
    }
    closePosition(id);
  };
  const closePortfolioPositionPartial = (id, percent) => {
    if (live.wallet && livePositions.some((position) => position.id === id)) {
      setTicketMessage("Partial close needs a reduce-position instruction in the on-chain program.");
      notify("Partial close is backend scope", "warn");
      return;
    }
    closePositionPartial(id, percent);
  };
  const addPortfolioMargin = (id, amount) => {
    if (live.wallet && livePositions.some((position) => position.id === id)) {
      setTicketMessage("Add margin needs an adjust-margin instruction in the on-chain program.");
      notify("Adjust margin is backend scope", "warn");
      return;
    }
    addMarginToPosition(id, amount);
  };

  const portfolioProps = {
    activity: [...live.activity, ...activity].slice(0, 12),
    addMarginToPosition: addPortfolioMargin,
    balance: visibleBalance,
    cashInput,
    closePosition: closePortfolioPosition,
    closePositionPartial: closePortfolioPositionPartial,
    depositCollateral,
    locked: visibleLocked,
    maintenanceMargin,
    markets,
    pendingOrders,
    positionEquity,
    positionPnl,
    positions: visiblePositions,
    profile: activeProfile,
    setCashInput,
    withdrawCollateral,
    cancelPendingOrder,
  };

  if (viewMode === "portfolio") {
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
          <Stat label="Session" value={live.wallet ? "Phantom devnet" : connected ? "Demo wallet" : "Disconnected"} />
          <Stat label="Account equity" value={fmt(visibleAccountEquity)} />
          <Stat label="Free collateral" value={fmt(visibleFreeCollateral)} />
          <Stat label="Position margin" value={fmt(positionMargin)} />
          <Stat label="Reserved" value={fmt(pendingCollateral)} tone={pendingCollateral > 0 ? "warn" : undefined} />
          <Stat label="Reputation" value={activeProfile.reputationScore} />
          <button className="primary-action" type="button" onClick={() => live.connectAndLoad().catch((error) => setTicketMessage(error.message))}>
            {live.wallet ? "Refresh Wallet" : "Connect Phantom"}
          </button>
        </section>
        <section className="portfolio-page" aria-label="Portfolio overview">
          <div className="overview-grid">
            <Stat label="Account equity" value={fmt(visibleAccountEquity)} />
            <Stat label="Free collateral" value={fmt(visibleFreeCollateral)} />
            <Stat label="Position margin" value={fmt(positionMargin)} />
            <Stat label="Unrealized PnL" value={fmt(visibleUnrealizedPnl)} tone={visibleUnrealizedPnl >= 0 ? "up" : "down"} />
            <Stat label="Realized PnL" value={fmt(activeProfile.realizedPnl)} tone={activeProfile.realizedPnl >= 0 ? "up" : "down"} />
          </div>
          <section className="collateral-card" aria-label="Collateral actions">
            <div className="panel-heading">
              <h2>Collateral</h2>
              <span>USDC demo vault</span>
            </div>
            <div className="cash-controls portfolio-cash">
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
          </section>
          <Portfolio {...portfolioProps} compactCashControls={true} />
          <ProfilePanel activity={[...live.activity, ...activity].slice(0, 12)} profile={activeProfile} />
        </section>
      </>
    );
  }

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
        <Stat label="Session" value={live.wallet ? "Phantom devnet" : connected ? "Demo wallet" : "Disconnected"} />
        <Stat label="Equity" value={fmt(visibleAccountEquity)} />
        <Stat label="Free" value={fmt(visibleFreeCollateral)} />
        <Stat label="Margin used" value={`${marginUsage.toFixed(1)}%`} tone={marginUsage > 70 ? "warn" : "up"} />
        <Stat label="Reserved" value={fmt(pendingCollateral)} tone={pendingCollateral > 0 ? "warn" : undefined} />
        <Stat label="Reputation" value={activeProfile.reputationScore} />
        <button className="primary-action" type="button" onClick={() => live.connectAndLoad().catch((error) => setTicketMessage(error.message))}>
          {live.wallet ? "Refresh Wallet" : "Connect Phantom"}
        </button>
      </section>

      <section className="live-setup-strip" aria-label="Live trading setup">
        <div>
          <span>Wallet</span>
          <strong>{live.walletStatus}</strong>
        </div>
        <div>
          <span>Program</span>
          <strong>{live.program ? "Loaded" : "Not loaded"}</strong>
        </div>
        <div>
          <span>Profile</span>
          <strong>{live.profile ? "Ready" : "Missing"}</strong>
        </div>
        <div>
          <span>Token account</span>
          <strong>{live.ownerTokenAccount ? live.tokenBalance : "Missing"}</strong>
        </div>
        <button type="button" onClick={() => live.createProfile().catch((error) => setTicketMessage(error.message))}>
          Create Profile
        </button>
        <button type="button" onClick={() => live.createTokenAccount().catch((error) => setTicketMessage(error.message))}>
          Create Token Account
        </button>
        <button type="button" onClick={() => live.refresh().catch((error) => setTicketMessage(error.message))}>
          Refresh State
        </button>
        <p>{live.busyAction ? `Pending: ${live.busyAction}` : live.status}</p>
      </section>

      <section className="market-row" aria-label="Market selector">
        <div className="market-tabs">
          {markets.map((market, index) => {
            const quote = marketData.quotes[market.symbol];
            const change = quote?.change24h ?? market.change;
            return (
              <button
                className={`market-tab ${index === activeMarket ? "active" : ""}`}
                key={market.symbol}
                type="button"
                onClick={() => setActiveMarket(index)}
              >
                <strong>{market.symbol}</strong>
                <span className={change >= 0 ? "up" : "down"}>
                  {fmt(quote?.price ?? market.price)} {pct(change)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="market-stats market-overview">
          <div className="market-identity">
            <strong>{active.symbol}</strong>
            <span>{displayActive.oracle}</span>
          </div>
          <Stat label="Mark" value={fmt(displayActive.price)} />
          <Stat label="24h" value={pct(displayActive.change)} tone={displayActive.change >= 0 ? "up" : "down"} />
          <Stat label="24h volume" value={Number.isFinite(marketVolume) ? fmt(marketVolume, 0) : "Loading"} />
          <Stat label="24h high / low" value={Number.isFinite(marketHigh) && Number.isFinite(marketLow) ? `${fmt(marketHigh)} / ${fmt(marketLow)}` : "Loading"} />
          <Stat label="Market cap" value={Number.isFinite(marketCap) ? fmt(marketCap, 0) : "Loading"} />
          <Stat label="Protocol OI" value={fmt(openInterestFor(activeMarket), 0)} />
          <Stat
            label="Funding / 1h"
            value={`${displayActive.funding >= 0 ? "+" : ""}${displayActive.funding.toFixed(3)}%`}
            tone={displayActive.funding >= 0 ? "up" : "down"}
          />
          <Stat label="Next funding" value={`${nextFundingMinutes}m`} />
          <Stat label="Taker fee" value="0.05%" />
          <Stat label="Data" value={`${marketQuote?.source ?? marketData.status} ${marketUpdatedAt}`} />
          <MiniSparkline points={chartPoints.slice(-28)} positive={displayActive.change >= 0} />
        </div>
      </section>

      <section className="workspace">
        <section className="chart-panel" aria-label="Price chart">
          <div className="panel-heading">
            <h2>{active.symbol}</h2>
            <div className="segmented" role="group" aria-label="Chart timeframe">
              {chartFrames.map((item) => (
                <button className={`segment ${timeframe === item ? "active" : ""}`} key={item} type="button" onClick={() => setTimeframe(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>
          <PriceChart points={chartPoints} positive={displayActive.change >= 0} />
          <div className="trade-tape">
            {chartPoints
              .slice(-5)
              .reverse()
              .map((price, index, list) => {
                const previous = list[index + 1] ?? price;
                const up = price >= previous;
                return (
                  <div className="tape-print" key={`${price}-${index}`}>
                    <strong className={up ? "up" : "down"}>{fmt(price)}</strong>
                    <span>{up ? "Up tick" : "Down tick"} {active.base}</span>
                  </div>
                );
              })}
          </div>
        </section>

        <OrderBook market={displayActive} />

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
              Long / Buy
            </button>
            <button className={`short ${side === "short" ? "active" : ""}`} type="button" onClick={() => setSide("short")}>
              Short / Sell
            </button>
          </div>
          <div className="available-row">
            <span>Available</span>
            <strong>{fmt(visibleFreeCollateral)}</strong>
          </div>
          <label>
            Price
            <input
              disabled={orderType === "market"}
              min="0.01"
              step="0.01"
              type="number"
              value={orderType === "market" ? displayActive.price.toFixed(2) : orderType === "limit" ? limitPriceInput : triggerPriceInput}
              onChange={(event) =>
                orderType === "limit" ? setLimitPriceInput(event.target.value) : setTriggerPriceInput(event.target.value)
              }
            />
          </label>
          <label>
            Collateral
            <input min="1" step="1" type="number" value={collateralInput} onChange={(event) => setCollateralInput(event.target.value)} />
          </label>
          <div className="quick-grid" role="group" aria-label="Collateral percentage">
            {sizingPresets.map((item) => (
              <button key={item} type="button" onClick={() => setCollateralByPercent(item)}>
                {item}%
              </button>
            ))}
          </div>
          <label>
            Leverage
            <input max={maxLeverage} min="1" step="1" type="range" value={leverage} onChange={(event) => setLeverageInput(event.target.value)} />
            <span>
              {leverage}x max {maxLeverage}x
            </span>
          </label>
          <div className="leverage-presets" role="group" aria-label="Leverage presets">
            {leveragePresets.map((item) => (
              <button
                className={leverage === item ? "active" : ""}
                disabled={item > maxLeverage}
                key={item}
                type="button"
                onClick={() => setLeverageInput(item)}
              >
                {item}x
              </button>
            ))}
          </div>
          <div className="ticket-preview">
            <Preview label="Order value" value={fmt(size)} />
            <Preview label="Size" value={fmt(size)} />
            <Preview label="Price" value={orderPriceLabel} />
            <Preview label="Margin required" value={fmt(collateral)} />
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
                  <button type="button" onClick={() => cancelPendingOrder(order.id)}>
                    Cancel {fmt(order.price)}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </aside>

        <Portfolio {...portfolioProps} />
        <ProfilePanel activity={[...live.activity, ...activity].slice(0, 12)} profile={activeProfile} />
      </section>
    </>
  );
}
