import { Preview, Stat } from "../shared/Stat";
import { clamp, fmt } from "../../lib/format";

export function Portfolio({
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
  const winRate = profile.totalTrades ? (profile.winningTrades / profile.totalTrades) * 100 : 0;

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
        <Stat label="Realized PnL" value={fmt(profile.realizedPnl)} tone={profile.realizedPnl >= 0 ? "up" : "down"} />
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
          <div className="empty-state">
            <Preview label="Open positions" value="None" />
          </div>
        ) : (
          positions.map((position) => {
            const market = markets[position.marketIndex];
            const pnl = positionPnl(position);
            const health = clamp((positionEquity(position) / maintenanceMargin(position)) * 100, 0, 999);
            const healthClass = health < 130 ? "down" : health < 220 ? "warn" : "up";
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
                <button className="position-action" type="button" onClick={() => closePosition(position.id)}>
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
