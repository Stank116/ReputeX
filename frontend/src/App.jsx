import { useState } from "react";

import { LiveDevnetConsole } from "./components/live/LiveDevnetConsole";
import { TradingTerminal } from "./components/trading/TradingTerminal";

function App() {
  const [view, setView] = useState("home");

  return (
    <main className="terminal-shell">
      <header className="topbar">
        <section className="brand-block" aria-label="Protocol summary">
          <div className="brand-mark" aria-hidden="true">
            <span className="brand-triangle" />
          </div>
          <div>
            <h1>Zenith</h1>
            <p>ON-CHAIN PERPETUALS</p>
          </div>
        </section>

        <nav className="app-tabs" aria-label="Frontend mode">
          <button className={view === "home" ? "active" : ""} type="button" onClick={() => setView("home")}>
            Home
          </button>
          <button className={view === "trade" ? "active" : ""} type="button" onClick={() => setView("trade")}>
            Trade
          </button>
          <button className={view === "portfolio" ? "active" : ""} type="button" onClick={() => setView("portfolio")}>
            Portfolio
          </button>
        </nav>

        <section className="topbar-actions" aria-label="Network and wallet">
          <div className="network-status">
            <span className="status-dot" aria-hidden="true" />
            <strong>SOLANA · DEVNET</strong>
          </div>
          <button className="wallet-pill" type="button" onClick={() => setView("trade")}>
            Connect Wallet
          </button>
        </section>
      </header>

      {view === "home" ? <LandingPage onStart={() => setView("trade")} /> : view === "live" ? <LiveDevnetConsole /> : <TradingTerminal viewMode={view} />}
    </main>
  );
}

function LandingPage({ onStart }) {
  return (
    <section className="landing-page" aria-label="ReputeX landing page">
      <div className="landing-hero">
        <div className="hero-copy">
          <span className="status-pill live">Solana Devnet</span>
          <h2>ReputeX</h2>
          <p>Trade SOL perpetuals with on-chain margin, wallet-signed transactions, and a reputation score that controls leverage.</p>
          <div className="hero-actions">
            <button className="primary-action" type="button" onClick={onStart}>
              Launch Trading
            </button>
            <button className="secondary-action" type="button" onClick={onStart}>
              View Live Markets
            </button>
          </div>
        </div>
        <div className="landing-terminal" aria-label="Protocol highlights">
          <div>
            <span>Wallet</span>
            <strong>Phantom</strong>
          </div>
          <div>
            <span>Market</span>
            <strong>SOL-PERP</strong>
          </div>
          <div>
            <span>Orders</span>
            <strong>Market, limit preview</strong>
          </div>
          <div>
            <span>Risk</span>
            <strong>Margin + liquidation meter</strong>
          </div>
        </div>
      </div>
      <div className="landing-grid">
        <article>
          <h3>Live Wallet Trading</h3>
          <p>Live prices are visible to everyone. Phantom is only needed when you want to create a profile, deposit collateral, or place a devnet trade.</p>
        </article>
        <article>
          <h3>Trader Workspace</h3>
          <p>Market stats, chart, order book, order ticket, positions, open orders, and trade history live in one terminal layout.</p>
        </article>
        <article>
          <h3>Production Path</h3>
          <p>The frontend is wired to your current program. Full on-chain limit orders and keepers need matching backend accounts/instructions.</p>
        </article>
      </div>
    </section>
  );
}

export default App;
