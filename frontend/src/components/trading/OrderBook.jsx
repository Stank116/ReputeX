import { useMemo } from "react";

import { BASIS_POINTS } from "../../lib/perps";
import { fmt } from "../../lib/format";

export function OrderBook({ market }) {
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
        {fmt(market.price * (1 + ((side === "ask" ? 1 : -1) * level.bps) / BASIS_POINTS))}
      </span>
      <span>{fmt(level.size, 0)}</span>
    </div>
  );

  return (
    <aside className="book-panel" aria-label="Order book">
      <div className="panel-heading compact">
        <h2>Order Book</h2>
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
        <div className="book-side bids">{levels.map((level) => row(level, "bid"))}</div>
      </div>
    </aside>
  );
}
