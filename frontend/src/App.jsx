import { useState } from "react";

import { PROGRAM_ID } from "./config/markets";
import { LiveDevnetConsole } from "./components/live/LiveDevnetConsole";
import { TradingTerminal } from "./components/trading/TradingTerminal";
import { shortKey } from "./lib/format";

function App() {
  const [view, setView] = useState("terminal");

  return (
    <main className="terminal-shell">
      <header className="topbar">
        <section className="brand-block" aria-label="Protocol summary">
          <div className="brand-mark">RX</div>
          <div>
            <h1>ReputeX</h1>
            <p>On-chain reputation perps</p>
          </div>
        </section>

        <nav className="app-tabs" aria-label="Frontend mode">
          <button className={view === "terminal" ? "active" : ""} type="button" onClick={() => setView("terminal")}>
            Terminal
          </button>
          <button className={view === "live" ? "active" : ""} type="button" onClick={() => setView("live")}>
            Live Devnet
          </button>
        </nav>

        <section className="program-badge" aria-label="Deployment">
          <span>Devnet program</span>
          <strong>{shortKey(PROGRAM_ID)}</strong>
        </section>
      </header>

      {view === "terminal" ? <TradingTerminal /> : <LiveDevnetConsole />}
    </main>
  );
}

export default App;
