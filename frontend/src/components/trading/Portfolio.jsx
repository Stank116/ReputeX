import { useState } from "react";

import { Preview } from "../shared/Stat";
import { clamp, fmt } from "../../lib/format";
import { liquidationPrice } from "../../lib/perps";

function PositionControls({ position, onAddMargin, onClosePartial, onClose }) {
  const [marginAmount, setMarginAmount] = useState(100);
  const [closePercent, setClosePercent] = useState(50);
  const liveOnly = Boolean(position.live);

  return (
    <div className="position-controls">
      <input
        min="1"
        step="1"
        type="number"
        value={marginAmount}
        aria-label="Margin amount"
        onChange={(event) => setMarginAmount(event.target.value)}
      />
      <button disabled={liveOnly} type="button" onClick={() => onAddMargin(position.id, Number(marginAmount))}>
        Add
      </button>
      <select value={closePercent} aria-label="Partial close percentage" onChange={(event) => setClosePercent(Number(event.target.value))}>
        <option value="25">25%</option>
        <option value="50">50%</option>
        <option value="75">75%</option>
      </select>
      <button disabled={liveOnly} type="button" onClick={() => onClosePartial(position.id, closePercent)}>
        Reduce
      </button>
      <button type="button" onClick={() => onClose(position.id)}>
        Close
      </button>
    </div>
  );
}

export function Portfolio({
  activity = [],
  addMarginToPosition,
  balance,
  cashInput,
  closePosition,
  closePositionPartial,
  compactCashControls = false,
  cancelPendingOrder,
  depositCollateral,
  locked,
  maintenanceMargin,
  markets,
  pendingOrders = [],
  positionEquity,
  positionPnl,
  positions,
  profile,
  setCashInput,
  withdrawCollateral,
}) {
  const [activeTab, setActiveTab] = useState("positions");

  return (
    <section className="portfolio-panel" aria-label="Portfolio">
      <div className="panel-heading">
        <h2>Portfolio</h2>
        {compactCashControls ? (
          <span>{positions.length} positions</span>
        ) : (
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
        )}
      </div>
      <div className="table-tabs" role="group" aria-label="Portfolio table">
        {[
          ["positions", `Positions ${positions.length}`],
          ["orders", `Open Orders ${pendingOrders.length}`],
          ["history", `Trade History ${activity.filter((item) => item !== "Session ready").length}`],
        ].map(([value, label]) => (
          <button className={activeTab === value ? "active" : ""} key={value} type="button" onClick={() => setActiveTab(value)}>
            {label}
          </button>
        ))}
      </div>
      <div className="positions-table">
        {activeTab === "positions" ? (
          <>
            <div className="table-header">
              <span>Market</span>
              <span>Side</span>
              <span>Size</span>
              <span>Entry</span>
            <span>Mark</span>
            <span>PnL</span>
            <span>Health</span>
            <span>Liq. gap</span>
            <span />
          </div>
            {positions.length === 0 ? (
              <div className="empty-state">
                <Preview label="Open positions" value="None" />
              </div>
            ) : (
              positions.map((position) => {
                const market = markets[position.marketIndex];
                const pnl = positionPnl(position);
                const health = clamp((positionEquity(position) / maintenanceMargin(position)) * 100, 0, 999);
                const healthClass = health < 130 ? "down" : health < 220 ? "warn" : "up";
                const liquidation = liquidationPrice(position.collateral, position.leverage, position.isLong, position.entryPrice);
                const liquidationGap = Math.abs((market.price - liquidation) / market.price) * 100;
                const gapClass = liquidationGap < 8 ? "down" : liquidationGap < 18 ? "warn" : "up";
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
                    <div className="health-cell">
                      <strong className={healthClass}>{health.toFixed(0)}%</strong>
                      <span style={{ "--health": `${Math.min(health, 100)}%` }} />
                    </div>
                    <strong className={gapClass}>{liquidationGap.toFixed(1)}%</strong>
                    <PositionControls
                      position={position}
                      onAddMargin={addMarginToPosition}
                      onClosePartial={closePositionPartial}
                      onClose={closePosition}
                    />
                  </div>
                );
              })
            )}
          </>
        ) : null}
        {activeTab === "orders" ? (
          <>
            <div className="table-header order-grid">
              <span>Market</span>
              <span>Side</span>
              <span>Type</span>
              <span>Trigger</span>
              <span>Margin</span>
              <span>Leverage</span>
              <span />
            </div>
            {pendingOrders.length === 0 ? (
              <div className="empty-state">
                <Preview label="Open orders" value="None" />
              </div>
            ) : (
              pendingOrders.map((order) => (
                <div className="position-row order-grid" key={order.id}>
                  <strong>{markets[order.marketIndex].symbol}</strong>
                  <span className={order.isLong ? "long-text" : "short-text"}>{order.isLong ? "Long" : "Short"}</span>
                  <span>{order.type}</span>
                  <span>{fmt(order.price)}</span>
                  <span>{fmt(order.collateral)}</span>
                  <span>{order.leverage}x</span>
                  <button className="position-action" type="button" onClick={() => cancelPendingOrder(order.id)}>
                    Cancel
                  </button>
                </div>
              ))
            )}
          </>
        ) : null}
        {activeTab === "history" ? (
          <>
            <div className="table-header history-grid">
              <span>Time</span>
              <span>Event</span>
            </div>
            {activity.filter((item) => item !== "Session ready").length === 0 ? (
              <div className="empty-state">
                <Preview label="Trade history" value="None" />
              </div>
            ) : (
              activity
                .filter((item) => item !== "Session ready")
                .map((item) => {
                  const [time, ...eventParts] = item.split(" - ");
                  return (
                    <div className="position-row history-grid" key={item}>
                      <strong>{time}</strong>
                      <span>{eventParts.join(" - ") || item}</span>
                    </div>
                  );
                })
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}
