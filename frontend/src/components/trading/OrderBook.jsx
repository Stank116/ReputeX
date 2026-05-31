import { useMemo } from "react";

import { BASIS_POINTS } from "../../lib/perps";

const bookPrice = (value) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
const bookSize = (value) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

export function OrderBook({ market }) {
  const levels = useMemo(
    () =>
      Array.from({ length: 5 }, (_, index) => ({
        bps: (index + 1) * 4,
        size: 3000 + Math.round(Math.random() * 18000),
      })),
    [market.price]
  );
  const askRows = levels
    .slice()
    .reverse()
    .map((level, index, list) => ({
      ...level,
      total: list.slice(0, index + 1).reduce((sum, item) => sum + item.size, 0),
    }));
  const bidRows = levels.map((level, index, list) => ({
    ...level,
    total: list.slice(index).reduce((sum, item) => sum + item.size, 0),
  }));
  const maxTotal = Math.max(...askRows.concat(bidRows).map((level) => level.total));
  const row = (level, side) => (
    <div
      className={`book-row ${side}`}
      key={`${side}-${level.bps}`}
      style={{ "--depth": `${Math.round((level.total / maxTotal) * 92)}%` }}
    >
      <span>{bookPrice(market.price * (1 + ((side === "ask" ? 1 : -1) * level.bps) / BASIS_POINTS))}</span>
      <span>{bookSize(level.size)}</span>
      <span>{bookSize(level.total)}</span>
    </div>
  );

  return (
    <aside className="book-panel" aria-label="Order book">
      <div className="book-heading">
        <h2>ORDER BOOK</h2>
        <div>
          <span>PRICE</span>
          <span>SIZE</span>
          <span>TOTAL</span>
        </div>
      </div>
      <div className="book-grid">
        <div className="book-side asks">{askRows.map((level) => row(level, "ask"))}</div>
        <div className="book-mid">
          <strong>{bookPrice(market.price)}</strong>
          <span>SPREAD 4.00 · 2.70%</span>
        </div>
        <div className="book-side bids">{bidRows.map((level) => row(level, "bid"))}</div>
      </div>
    </aside>
  );
}
