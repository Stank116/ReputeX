const BASIS_POINTS = 10000;
const MAINTENANCE_MARGIN_BPS = 625;

const markets = [
  { symbol: "SOL-PERP", base: "SOL", price: 158.42, funding: 0.012, change: 2.34, maxLev: 5 },
  { symbol: "BTC-PERP", base: "BTC", price: 68480, funding: -0.004, change: -0.86, maxLev: 5 },
  { symbol: "ETH-PERP", base: "ETH", price: 3742, funding: 0.008, change: 1.18, maxLev: 5 },
  { symbol: "JUP-PERP", base: "JUP", price: 1.17, funding: 0.021, change: 4.73, maxLev: 4 },
];

const state = {
  connected: false,
  activeMarket: 0,
  side: "long",
  balance: 0,
  locked: 0,
  nextPositionId: 0,
  positions: [],
  history: new Map(),
  profile: {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    liquidations: 0,
    totalVolume: 0,
    realizedPnl: 0,
    avgLeverageX100: 0,
    reputationScore: 100,
  },
  activity: [],
};

const el = (id) => document.getElementById(id);
const fmt = (value, digits = 2) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
const pct = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function boot() {
  markets.forEach((market, index) => {
    const points = Array.from({ length: 72 }, (_, i) => {
      const wave = Math.sin(i / 7) * market.price * 0.012;
      const drift = (i - 36) * market.price * 0.0005;
      return market.price + wave + drift;
    });
    state.history.set(index, points);
    market.price = points.at(-1);
  });

  bindEvents();
  render();
  setInterval(tickMarkets, 1800);
}

function bindEvents() {
  el("walletButton").addEventListener("click", () => {
    state.connected = !state.connected;
    log(state.connected ? "Wallet connected" : "Wallet disconnected");
    render();
  });

  el("longButton").addEventListener("click", () => setSide("long"));
  el("shortButton").addEventListener("click", () => setSide("short"));
  el("submitOrder").addEventListener("click", openPosition);
  el("depositButton").addEventListener("click", depositCollateral);
  el("withdrawButton").addEventListener("click", withdrawCollateral);
  el("collateralInput").addEventListener("input", renderTicket);
  el("leverageInput").addEventListener("input", renderTicket);

  document.querySelectorAll(".segment").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".segment").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
    });
  });
}

function setSide(side) {
  state.side = side;
  el("longButton").classList.toggle("active", side === "long");
  el("shortButton").classList.toggle("active", side === "short");
  renderTicket();
}

function tickMarkets() {
  markets.forEach((market, index) => {
    const history = state.history.get(index);
    const bias = market.change / 2400;
    const wave = Math.sin(Date.now() / 9000 + index) * 0.0009;
    const impulse = (Math.random() - 0.5) * 0.0035;
    market.price = Math.max(market.price * (1 + bias + wave + impulse), 0.01);
    market.change = market.change * 0.985 + (bias + impulse) * 120;
    history.push(market.price);
    if (history.length > 90) history.shift();
  });
  autoLiquidate();
  render();
}

function activeMarket() {
  return markets[state.activeMarket];
}

function reputationLeverageCap(score, marketMax) {
  let reputationCap = 5;
  if (score < 80) reputationCap = 2;
  else if (score < 120) reputationCap = 3;
  else if (score < 180) reputationCap = 4;
  return Math.min(reputationCap, marketMax);
}

function positionPnl(position) {
  const mark = markets[position.marketIndex].price;
  const delta = position.isLong ? mark - position.entryPrice : position.entryPrice - mark;
  return (delta * position.size) / position.entryPrice;
}

function positionEquity(position) {
  return position.collateral + positionPnl(position);
}

function maintenanceMargin(position) {
  return (position.size * MAINTENANCE_MARGIN_BPS) / BASIS_POINTS;
}

function healthPercent(position) {
  return clamp((positionEquity(position) / maintenanceMargin(position)) * 100, 0, 999);
}

function liquidationPrice(collateral, leverage, isLong, entryPrice) {
  const size = collateral * leverage;
  const maintenance = maintenanceMargin({ size });
  const lossToMaintenance = collateral - maintenance;
  const priceMove = (lossToMaintenance * entryPrice) / size;
  return isLong ? Math.max(entryPrice - priceMove, 0) : entryPrice + priceMove;
}

function freeCollateral() {
  return Math.max(state.balance - state.locked, 0);
}

function unrealizedPnl() {
  return state.positions.reduce((sum, position) => sum + positionPnl(position), 0);
}

function accountEquity() {
  return state.balance + unrealizedPnl();
}

function openInterestFor(index) {
  return state.positions
    .filter((position) => position.marketIndex === index)
    .reduce((sum, position) => sum + position.size, 0);
}

function openPosition() {
  if (!state.connected) return showMessage("Connect a wallet first.");

  const market = activeMarket();
  const collateral = Number(el("collateralInput").value);
  const leverage = Number(el("leverageInput").value);

  if (!Number.isFinite(collateral) || collateral <= 0) return showMessage("Collateral must be above zero.");
  const allowedLeverage = reputationLeverageCap(state.profile.reputationScore, market.maxLev);
  if (leverage < 1 || leverage > allowedLeverage) {
    return showMessage(`Current reputation allows up to ${allowedLeverage}x on ${market.symbol}.`);
  }
  if (freeCollateral() < collateral) return showMessage("Insufficient free collateral.");

  const position = {
    id: state.nextPositionId++,
    marketIndex: state.activeMarket,
    isLong: state.side === "long",
    collateral,
    leverage,
    entryPrice: market.price,
    size: collateral * leverage,
    openedAt: new Date(),
  };

  state.positions.push(position);
  state.locked += collateral;
  log(`Opened ${position.isLong ? "long" : "short"} ${market.symbol} ${fmt(position.size, 0)} at ${fmt(position.entryPrice)}`);
  showMessage("Position opened.");
  render();
}

function closePosition(id, liquidated = false) {
  const index = state.positions.findIndex((position) => position.id === id);
  if (index < 0) return;

  const [position] = state.positions.splice(index, 1);
  const pnl = positionPnl(position);

  state.locked = Math.max(state.locked - position.collateral, 0);
  state.balance = liquidated
    ? Math.max(state.balance - position.collateral, 0)
    : Math.max(state.balance + pnl, 0);

  applyTradeToProfile(position, pnl, liquidated);
  const market = markets[position.marketIndex];
  log(`${liquidated ? "Liquidated" : "Closed"} ${market.symbol} ${pnl >= 0 ? "+" : ""}${fmt(pnl)}`);
  render();
}

function autoLiquidate() {
  const toLiquidate = state.positions
    .filter((position) => positionEquity(position) <= maintenanceMargin(position))
    .map((position) => position.id);
  toLiquidate.forEach((id) => closePosition(id, true));
}

function applyTradeToProfile(position, pnl, liquidated) {
  const profile = state.profile;
  const previousTrades = profile.totalTrades;
  profile.totalTrades += 1;
  profile.totalVolume += position.size;
  profile.realizedPnl += pnl;

  if (pnl > 0 && !liquidated) profile.winningTrades += 1;
  else profile.losingTrades += 1;
  if (liquidated) profile.liquidations += 1;

  const newLev = position.leverage * 100;
  profile.avgLeverageX100 =
    previousTrades === 0
      ? newLev
      : Math.floor((profile.avgLeverageX100 * previousTrades + newLev) / profile.totalTrades);

  const winBonus = profile.winningTrades * 8;
  const experienceBonus = profile.totalTrades * 3;
  const volumeBonus = Math.floor(profile.totalVolume / 1000);
  const pnlBonus = profile.realizedPnl > 0 ? Math.floor(profile.realizedPnl / 1000) : 0;
  const liquidationPenalty = profile.liquidations * 30;
  const leveragePenalty = Math.floor(Math.max(profile.avgLeverageX100 - 200, 0) / 20);
  profile.reputationScore = Math.max(
    0,
    100 + winBonus + experienceBonus + volumeBonus + pnlBonus - liquidationPenalty - leveragePenalty
  );
}

function depositCollateral() {
  if (!state.connected) return showMessage("Connect a wallet first.");
  const amount = Number(el("cashInput").value);
  if (!Number.isFinite(amount) || amount <= 0) return showMessage("Deposit amount must be above zero.");
  state.balance += amount;
  log(`Deposited ${fmt(amount)}`);
  render();
}

function withdrawCollateral() {
  if (!state.connected) return showMessage("Connect a wallet first.");
  const amount = Number(el("cashInput").value);
  if (!Number.isFinite(amount) || amount <= 0) return showMessage("Withdraw amount must be above zero.");
  if (freeCollateral() < amount) return showMessage("Insufficient free collateral.");
  state.balance -= amount;
  log(`Withdrew ${fmt(amount)}`);
  render();
}

function render() {
  renderAccount();
  renderMarkets();
  renderChart();
  renderBook();
  renderTicket();
  renderPortfolio();
  renderProfile();
}

function renderAccount() {
  el("walletLabel").textContent = state.connected ? "RX7b...91df" : "Disconnected";
  el("walletButton").textContent = state.connected ? "Disconnect" : "Connect";
  el("equityLabel").textContent = fmt(accountEquity());
  el("freeCollateralLabel").textContent = fmt(freeCollateral());
  el("reputationLabel").textContent = state.profile.reputationScore;
}

function renderMarkets() {
  el("marketTabs").innerHTML = markets
    .map(
      (market, index) => `
      <button class="market-tab ${index === state.activeMarket ? "active" : ""}" type="button" data-index="${index}">
        <strong>${market.symbol}</strong>
        <span class="${market.change >= 0 ? "up" : "down"}">${fmt(market.price)} ${pct(market.change)}</span>
      </button>`
    )
    .join("");

  document.querySelectorAll(".market-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeMarket = Number(button.dataset.index);
      render();
    });
  });

  const market = activeMarket();
  el("chartTitle").textContent = market.symbol;
  el("markPrice").textContent = fmt(market.price);
  el("change24h").textContent = pct(market.change);
  el("change24h").className = market.change >= 0 ? "up" : "down";
  el("fundingRate").textContent = `${market.funding >= 0 ? "+" : ""}${market.funding.toFixed(3)}%`;
  el("fundingRate").className = market.funding >= 0 ? "up" : "down";
  el("openInterest").textContent = fmt(openInterestFor(state.activeMarket), 0);
}

function renderChart() {
  const canvas = el("priceChart");
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  ctx.scale(ratio, ratio);

  const width = rect.width;
  const height = rect.height;
  const pad = 28;
  const points = state.history.get(state.activeMarket);
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
  ctx.strokeStyle = activeMarket().change >= 0 ? "#20c997" : "#ff5b6e";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = "#8c9aa7";
  ctx.font = "12px system-ui";
  ctx.fillText(fmt(max), width - 92, 18);
  ctx.fillText(fmt(min), width - 92, height - 10);

  el("tradeTape").innerHTML = points
    .slice(-5)
    .reverse()
    .map((price, index, list) => {
      const previous = list[index + 1] ?? price;
      const up = price >= previous;
      return `<div class="tape-print"><strong class="${up ? "up" : "down"}">${fmt(price)}</strong><span>${up ? "Buy" : "Sell"} ${activeMarket().base}</span></div>`;
    })
    .join("");
}

function renderBook() {
  const market = activeMarket();
  const levels = Array.from({ length: 9 }, (_, index) => {
    const bps = (index + 1) * 4;
    const size = 3000 + Math.round(Math.random() * 18000);
    return { bps, size };
  });
  const maxSize = Math.max(...levels.map((level) => level.size));
  el("askBook").innerHTML = levels
    .slice()
    .reverse()
    .map((level) => bookRow(market.price * (1 + level.bps / BASIS_POINTS), level.size, maxSize))
    .join("");
  el("bidBook").innerHTML = levels
    .map((level) => bookRow(market.price * (1 - level.bps / BASIS_POINTS), level.size, maxSize))
    .join("");
  el("bookMid").textContent = fmt(market.price);
  el("spreadLabel").textContent = "8.00 bps";
}

function bookRow(price, size, maxSize) {
  return `<div class="book-row" style="--depth:${Math.round((size / maxSize) * 92)}%">
    <span>${fmt(price)}</span>
    <span>${fmt(size, 0)}</span>
  </div>`;
}

function renderTicket() {
  const market = activeMarket();
  const collateral = Math.max(Number(el("collateralInput").value) || 0, 0);
  const maxLeverage = reputationLeverageCap(state.profile.reputationScore, market.maxLev);
  const leverage = Math.min(Number(el("leverageInput").value) || 1, maxLeverage);
  el("leverageInput").max = maxLeverage;
  el("leverageInput").value = leverage;
  const size = collateral * leverage;
  el("leverageLabel").textContent = `${leverage}x max ${maxLeverage}x`;
  el("sizePreview").textContent = fmt(size);
  el("entryPreview").textContent = fmt(market.price);
  el("liqPreview").textContent = fmt(liquidationPrice(collateral, leverage, state.side === "long", market.price));
  el("maintenancePreview").textContent = fmt((size * MAINTENANCE_MARGIN_BPS) / BASIS_POINTS);
  el("submitOrder").textContent = `Open ${state.side === "long" ? "Long" : "Short"}`;
}

function renderPortfolio() {
  el("balanceLabel").textContent = fmt(state.balance);
  el("lockedLabel").textContent = fmt(state.locked);
  el("realizedLabel").textContent = fmt(state.profile.realizedPnl);
  el("realizedLabel").className = state.profile.realizedPnl >= 0 ? "up" : "down";
  const winRate = state.profile.totalTrades
    ? (state.profile.winningTrades / state.profile.totalTrades) * 100
    : 0;
  el("winRateLabel").textContent = `${winRate.toFixed(1)}%`;

  if (state.positions.length === 0) {
    el("positionsBody").innerHTML = `<div class="empty-state">No open positions</div>`;
    return;
  }

  el("positionsBody").innerHTML = state.positions
    .map((position) => {
      const market = markets[position.marketIndex];
      const pnl = positionPnl(position);
      const health = healthPercent(position);
      const healthClass = health < 130 ? "down" : health < 220 ? "warn" : "up";
      return `<div class="position-row">
        <strong>${market.symbol}</strong>
        <span class="${position.isLong ? "long-text" : "short-text"}">${position.isLong ? "Long" : "Short"} ${position.leverage}x</span>
        <span>${fmt(position.size)}</span>
        <span>${fmt(position.entryPrice)}</span>
        <span>${fmt(market.price)}</span>
        <strong class="${pnl >= 0 ? "up" : "down"}">${fmt(pnl)}</strong>
        <strong class="${healthClass}">${health.toFixed(0)}%</strong>
        <button class="position-action" type="button" data-close="${position.id}">Close</button>
      </div>`;
    })
    .join("");

  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => closePosition(Number(button.dataset.close)));
  });
}

function renderProfile() {
  const profile = state.profile;
  el("profileScore").textContent = profile.reputationScore;
  el("scoreMeter").style.width = `${clamp(profile.reputationScore, 0, 180) / 1.8}%`;
  el("tradesLabel").textContent = profile.totalTrades;
  el("winsLabel").textContent = profile.winningTrades;
  el("lossesLabel").textContent = profile.losingTrades;
  el("liquidationsLabel").textContent = profile.liquidations;
  el("volumeLabel").textContent = fmt(profile.totalVolume, 0);
  el("avgLevLabel").textContent = `${(profile.avgLeverageX100 / 100).toFixed(2)}x`;
  el("activityLog").innerHTML =
    state.activity.map((entry) => `<div class="log-entry">${entry}</div>`).join("") ||
    `<div class="log-entry">Session ready</div>`;
}

function showMessage(message) {
  el("ticketMessage").textContent = message;
}

function log(message) {
  const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  state.activity.unshift(`${stamp} - ${message}`);
  state.activity = state.activity.slice(0, 8);
}

window.addEventListener("resize", renderChart);
boot();
