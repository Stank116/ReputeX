import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";

import { getProvider } from "./provider";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const DEFAULT_PYTH_PRICE_UPDATE = new PublicKey(
  "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
);
const PROGRAM_ROOT = path.resolve(__dirname, "..");
const DEFAULT_AUTHORITY_PATH = path.join(
  PROGRAM_ROOT,
  ".devnet",
  "authority.json"
);
const DEFAULT_MINT_PATH = path.join(
  PROGRAM_ROOT,
  ".devnet",
  "collateral-mint.json"
);
const DEFAULT_DECIMALS = Number(process.env.COLLATERAL_DECIMALS ?? "6");
const MARKET_SYMBOLS: Record<
  number,
  { base: string; binance: string; coingecko: string }
> = {
  0: { base: "SOL", binance: "SOLUSDT", coingecko: "solana" },
  1: { base: "BTC", binance: "BTCUSDT", coingecko: "bitcoin" },
  2: { base: "ETH", binance: "ETHUSDT", coingecko: "ethereum" },
  3: { base: "JUP", binance: "JUPUSDT", coingecko: "jupiter-exchange-solana" },
};
const MARKET_ALIASES: Record<string, number> = Object.fromEntries(
  Object.entries(MARKET_SYMBOLS).flatMap(([index, market]) => [
    [market.base, Number(index)],
    [`${market.base}USDT`, Number(index)],
    [`${market.base}/USDT`, Number(index)],
    [`${market.base}-PERP`, Number(index)],
  ])
);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const ask = (question: string) =>
  new Promise<string>((resolve) => rl.question(question, resolve));
const short = (key: PublicKey | string) => {
  const text = typeof key === "string" ? key : key.toBase58();
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
};
const raw = (uiAmount: string | number) =>
  new anchor.BN(Math.trunc(Number(uiAmount) * 10 ** DEFAULT_DECIMALS));
const ui = (amount: anchor.BN | number | string) =>
  (Number(amount.toString()) / 10 ** DEFAULT_DECIMALS).toLocaleString("en-US", {
    maximumFractionDigits: DEFAULT_DECIMALS,
  });
const priceUi = (price: anchor.BN | number | string, decimals: number) =>
  (Number(price.toString()) / 10 ** decimals).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: decimals,
  });
const usd = (value: number, digits = 4) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  });

const u64Le = (value: number) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
};

const associatedTokenAddress = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];

const createAssociatedTokenAccountInstruction = (
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey
) => {
  const ata = associatedTokenAddress(owner, mint);
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.alloc(0),
  });
};

const mintToInstruction = (
  mint: PublicKey,
  destination: PublicKey,
  mintAuthority: PublicKey,
  amount: anchor.BN
) =>
  new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: mintAuthority, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([7]), u64Le(amount.toNumber())]),
  });

const ensureWalletEnv = () => {
  if (process.env.ANCHOR_WALLET || process.env.WALLET) return;
  const defaultSolanaWallet = path.join(
    os.homedir(),
    ".config",
    "solana",
    "id.json"
  );
  if (fs.existsSync(defaultSolanaWallet)) return;
  if (fs.existsSync(DEFAULT_AUTHORITY_PATH)) {
    process.env.ANCHOR_WALLET = DEFAULT_AUTHORITY_PATH;
  }
};

const loadProgram = (provider: anchor.AnchorProvider) => {
  const idlPath = path.join(PROGRAM_ROOT, "target", "idl", "reputex.json");
  if (!fs.existsSync(idlPath)) throw new Error(`IDL not found: ${idlPath}`);
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  return new anchor.Program(idl, provider);
};

const fetchJson = async (url: string): Promise<any> => {
  const response = await fetch(url, {
    headers: { "user-agent": "reputex-terminal-demo" },
  });
  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
};

const fetchTicker = async (marketIndex = 0) => {
  const symbols = MARKET_SYMBOLS[marketIndex] ?? MARKET_SYMBOLS[0];
  try {
    const ticker = await fetchJson(
      `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbols.binance}`
    );
    return {
      source: "Binance spot",
      symbol: symbols.binance,
      price: Number(ticker.lastPrice),
      changePct: Number(ticker.priceChangePercent),
      high: Number(ticker.highPrice),
      low: Number(ticker.lowPrice),
      volume: Number(ticker.volume),
    };
  } catch {
    const data = await fetchJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${symbols.coingecko}&vs_currencies=usd&include_24hr_change=true`
    );
    const item = data[symbols.coingecko];
    return {
      source: "CoinGecko spot",
      symbol: `${symbols.base}/USD`,
      price: Number(item.usd),
      changePct: Number(item.usd_24h_change ?? 0),
      high: Number.NaN,
      low: Number.NaN,
      volume: Number.NaN,
    };
  }
};

const fetchOrderBook = async (marketIndex = 0, limit = 10) => {
  const symbols = MARKET_SYMBOLS[marketIndex] ?? MARKET_SYMBOLS[0];
  const data = await fetchJson(
    `https://api.binance.com/api/v3/depth?symbol=${symbols.binance}&limit=${limit}`
  );
  return {
    source: "Binance spot order book",
    symbol: symbols.binance,
    bids: data.bids.map(([price, quantity]: [string, string]) => ({
      price: Number(price),
      quantity: Number(quantity),
      notional: Number(price) * Number(quantity),
    })),
    asks: data.asks.map(([price, quantity]: [string, string]) => ({
      price: Number(price),
      quantity: Number(quantity),
      notional: Number(price) * Number(quantity),
    })),
  };
};

const fetchCandles = async (marketIndex = 0, interval = "1m", limit = 30) => {
  const symbols = MARKET_SYMBOLS[marketIndex] ?? MARKET_SYMBOLS[0];
  const data = await fetchJson(
    `https://api.binance.com/api/v3/klines?symbol=${symbols.binance}&interval=${interval}&limit=${limit}`
  );
  return {
    source: "Binance spot candles",
    symbol: symbols.binance,
    interval,
    candles: data.map((row: any[]) => ({
      time: new Date(row[0]).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    })),
  };
};

const marketLabel = (marketIndex = 0) => {
  const symbols = MARKET_SYMBOLS[marketIndex] ?? MARKET_SYMBOLS[0];
  return `${symbols.base}/USDT`;
};

const numericArg = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const marketArg = (value: string | undefined) => {
  if (!value) return undefined;
  const asNumber = Number(value);
  if (Number.isInteger(asNumber) && MARKET_SYMBOLS[asNumber]) return asNumber;

  const normalized = value
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "-");
  return MARKET_ALIASES[normalized];
};

const parseMarketCommand = (args: string[]) => {
  const parsed = marketArg(args[0]);
  if (parsed !== undefined) {
    return { marketIndex: parsed, rest: args.slice(1) };
  }
  return { marketIndex: 0, rest: args };
};

const printAsciiCandles = (
  candles: Array<{ open: number; high: number; low: number; close: number }>
) => {
  if (!candles.length) return;
  const min = Math.min(...candles.map((candle) => candle.low));
  const max = Math.max(...candles.map((candle) => candle.high));
  const rows = 12;
  const scale = (value: number) =>
    Math.max(
      0,
      Math.min(
        rows - 1,
        Math.round(((max - value) / (max - min || 1)) * (rows - 1))
      )
    );

  for (let row = 0; row < rows; row += 1) {
    const price = max - ((max - min) * row) / (rows - 1 || 1);
    const cells = candles
      .map((candle) => {
        const high = scale(candle.high);
        const low = scale(candle.low);
        const open = scale(candle.open);
        const close = scale(candle.close);
        const bodyTop = Math.min(open, close);
        const bodyBottom = Math.max(open, close);
        if (row >= bodyTop && row <= bodyBottom)
          return candle.close >= candle.open ? "#" : "x";
        if (row >= high && row <= low) return "|";
        return " ";
      })
      .join("");
    console.log(`${price.toFixed(2).padStart(10)} | ${cells}`);
  }
  console.log(`${"".padStart(10)} + ${"-".repeat(candles.length)}`);
  console.log(`${"".padStart(12)} # up candle, x down candle, | wick`);
};

class LiveTerminal {
  provider: anchor.AnchorProvider;
  program: anchor.Program;
  owner: PublicKey;

  constructor() {
    ensureWalletEnv();
    this.provider = getProvider();
    anchor.setProvider(this.provider);
    this.program = loadProgram(this.provider);
    this.owner = this.provider.wallet.publicKey;
  }

  pdas(positionId = 0, marketIndex = 0) {
    const [protocol] = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol")],
      this.program.programId
    );
    const [collateralVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      this.program.programId
    );
    const [market] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), u64Le(marketIndex)],
      this.program.programId
    );
    const [traderProfile] = PublicKey.findProgramAddressSync(
      [Buffer.from("trader"), this.owner.toBuffer()],
      this.program.programId
    );
    const [marginAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("margin"), this.owner.toBuffer()],
      this.program.programId
    );
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), this.owner.toBuffer(), u64Le(positionId)],
      this.program.programId
    );
    return {
      protocol,
      collateralVault,
      market,
      traderProfile,
      marginAccount,
      position,
    };
  }

  async protocol() {
    return (this.program.account as any).protocol.fetch(this.pdas().protocol);
  }

  async market(marketIndex = 0) {
    return (this.program.account as any).market.fetch(
      this.pdas(0, marketIndex).market
    );
  }

  async ownerAta() {
    const protocol = await this.protocol();
    return associatedTokenAddress(
      this.owner,
      new PublicKey(protocol.collateralMint)
    );
  }

  async ensureAta() {
    const protocol = await this.protocol();
    const mint = new PublicKey(protocol.collateralMint);
    const ata = associatedTokenAddress(this.owner, mint);
    if (await this.provider.connection.getAccountInfo(ata)) {
      console.log(`Token account exists: ${ata.toBase58()}`);
      return ata;
    }
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(this.owner, this.owner, mint)
    );
    const sig = await this.provider.sendAndConfirm(tx);
    console.log(`Created token account: ${ata.toBase58()}`);
    console.log(`Signature: ${sig}`);
    return ata;
  }

  async createProfile() {
    const accounts = this.pdas();
    if (await this.provider.connection.getAccountInfo(accounts.traderProfile)) {
      console.log(
        `Profile already exists: ${accounts.traderProfile.toBase58()}`
      );
      return;
    }
    const sig = await this.program.methods
      .createTraderProfile()
      .accountsStrict({
        protocol: accounts.protocol,
        traderProfile: accounts.traderProfile,
        marginAccount: accounts.marginAccount,
        owner: this.owner,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`Created trader profile: ${sig}`);
  }

  async mint(amountUi: string) {
    if (!fs.existsSync(DEFAULT_MINT_PATH)) {
      throw new Error(
        "Generated collateral mint not found. Run bootstrap:devnet first."
      );
    }
    const secretKey = JSON.parse(fs.readFileSync(DEFAULT_MINT_PATH, "utf8"));
    const mint = new PublicKey(secretKey.slice(32));
    const ata = await this.ensureAta();
    const tx = new Transaction().add(
      mintToInstruction(mint, ata, this.owner, raw(amountUi))
    );
    const sig = await this.provider.sendAndConfirm(tx);
    console.log(`Minted ${amountUi} test collateral to ${ata.toBase58()}`);
    console.log(`Signature: ${sig}`);
  }

  async deposit(amountUi: string) {
    await this.createProfile();
    const accounts = this.pdas();
    const ownerTokenAccount = await this.ensureAta();
    const sig = await this.program.methods
      .depositCollateral(raw(amountUi))
      .accountsStrict({
        protocol: accounts.protocol,
        marginAccount: accounts.marginAccount,
        collateralVault: accounts.collateralVault,
        ownerTokenAccount,
        owner: this.owner,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    console.log(`Deposited ${amountUi} collateral`);
    console.log(`Signature: ${sig}`);
  }

  async fund(amountUi: string) {
    const accounts = this.pdas();
    const funderTokenAccount = await this.ensureAta();
    const sig = await this.program.methods
      .fundInsurance(raw(amountUi))
      .accountsStrict({
        protocol: accounts.protocol,
        collateralVault: accounts.collateralVault,
        funderTokenAccount,
        funder: this.owner,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    console.log(`Funded insurance with ${amountUi} collateral`);
    console.log(`Signature: ${sig}`);
  }

  async refresh(marketIndex = 0) {
    const accounts = this.pdas(0, marketIndex);
    const sig = await this.program.methods
      .updateMarketPriceFromPyth(new anchor.BN(marketIndex))
      .accountsStrict({
        protocol: accounts.protocol,
        market: accounts.market,
        priceUpdate: DEFAULT_PYTH_PRICE_UPDATE,
      })
      .rpc();
    console.log(`Refreshed Pyth price`);
    console.log(`Signature: ${sig}`);
  }

  async refreshInstruction(marketIndex = 0) {
    const accounts = this.pdas(0, marketIndex);
    return this.program.methods
      .updateMarketPriceFromPyth(new anchor.BN(marketIndex))
      .accountsStrict({
        protocol: accounts.protocol,
        market: accounts.market,
        priceUpdate: DEFAULT_PYTH_PRICE_UPDATE,
      })
      .instruction();
  }

  async open(
    side: string,
    amountUi: string,
    leverageText: string,
    marketIndex = 0
  ) {
    await this.createProfile();
    const protocol = await this.protocol();
    const positionId = Number(protocol.nextPositionId.toString());
    const accounts = this.pdas(positionId, marketIndex);
    const refreshIx = await this.refreshInstruction(marketIndex);
    const sig = await this.program.methods
      .openPosition(
        new anchor.BN(positionId),
        new anchor.BN(marketIndex),
        side.toLowerCase() !== "short",
        raw(amountUi),
        Number(leverageText)
      )
      .accountsStrict({
        protocol: accounts.protocol,
        market: accounts.market,
        traderProfile: accounts.traderProfile,
        marginAccount: accounts.marginAccount,
        position: accounts.position,
        owner: this.owner,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([refreshIx])
      .rpc();
    console.log(`Opened ${side.toUpperCase()} position #${positionId}`);
    console.log(`Position PDA: ${accounts.position.toBase58()}`);
    console.log(`Signature: ${sig}`);
  }

  async close(positionIdText: string, marketIndex = 0) {
    const positionId = Number(positionIdText);
    const accounts = this.pdas(positionId, marketIndex);
    const refreshIx = await this.refreshInstruction(marketIndex);
    const sig = await this.program.methods
      .closePosition(new anchor.BN(positionId), new anchor.BN(marketIndex))
      .accountsStrict({
        protocol: accounts.protocol,
        market: accounts.market,
        traderProfile: accounts.traderProfile,
        marginAccount: accounts.marginAccount,
        position: accounts.position,
        owner: this.owner,
      })
      .preInstructions([refreshIx])
      .rpc();
    console.log(`Closed position #${positionId}`);
    console.log(`Signature: ${sig}`);
  }

  async withdraw(amountUi: string) {
    const accounts = this.pdas();
    const ownerTokenAccount = await this.ensureAta();
    const sig = await this.program.methods
      .withdrawCollateral(raw(amountUi))
      .accountsStrict({
        protocol: accounts.protocol,
        marginAccount: accounts.marginAccount,
        collateralVault: accounts.collateralVault,
        ownerTokenAccount,
        owner: this.owner,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    console.log(
      `Withdrew ${amountUi} collateral to ${ownerTokenAccount.toBase58()}`
    );
    console.log(`Signature: ${sig}`);
  }

  async positions() {
    const protocol = await this.protocol();
    const total = Number(protocol.nextPositionId.toString());
    const rows = [];
    for (let id = 0; id < total; id += 1) {
      const pda = this.pdas(id).position;
      try {
        const position: any = await (
          this.program.account as any
        ).position.fetch(pda);
        if (position.owner.toBase58() !== this.owner.toBase58()) continue;
        rows.push({
          id,
          pda: short(pda),
          market: position.marketIndex.toString(),
          side: position.isLong ? "LONG" : "SHORT",
          collateral: ui(position.collateralAmount),
          leverage: `${position.leverage}x`,
          size: ui(position.size),
          entry: position.entryPrice.toString(),
          open: position.isOpen,
        });
      } catch {
        // Position account does not exist for this wallet/id.
      }
    }
    console.table(
      rows.length ? rows : [{ message: "No positions found for wallet" }]
    );
  }

  async marketData(marketIndex = 0) {
    const market: any =
      marketIndex === 0 ? await this.market(0).catch(() => null) : null;
    const ticker = await fetchTicker(marketIndex);
    console.log("\nLIVE MARKET DATA");
    console.log("Selected market:   ", marketLabel(marketIndex));
    console.log("Reference source:  ", ticker.source);
    console.log("Reference symbol:  ", ticker.symbol);
    console.log("Spot last price:   ", usd(ticker.price));
    console.log("24h change:        ", `${ticker.changePct.toFixed(2)}%`);
    if (Number.isFinite(ticker.high))
      console.log("24h high:          ", usd(ticker.high));
    if (Number.isFinite(ticker.low))
      console.log("24h low:           ", usd(ticker.low));
    if (Number.isFinite(ticker.volume)) {
      console.log("24h base volume:   ", ticker.volume.toLocaleString("en-US"));
    }
    if (market) {
      console.log("On-chain market:   ", market.symbol);
      console.log(
        "On-chain Pyth mark:",
        priceUi(market.price, market.priceDecimals)
      );
      console.log("On-chain slot:     ", market.lastPriceUpdateSlot.toString());
      console.log(
        "Note: ReputeX trades currently settle on SOL-PERP using this on-chain Pyth mark."
      );
    } else {
      console.log("On-chain market:   ", "not initialized in ReputeX");
      console.log(
        "Note: this is reference market data only. Current on-chain trading is SOL-PERP."
      );
    }
  }

  async orderBook(marketIndex = 0) {
    const book = await fetchOrderBook(marketIndex, 10);
    console.log(
      `\nORDER BOOK REFERENCE (${book.source}, ${book.symbol}, ${marketLabel(
        marketIndex
      )})`
    );
    console.log(
      "This is a reference CEX spot book. ReputeX itself uses oracle-priced perps."
    );
    const rows = [];
    for (let index = book.asks.length - 1; index >= 0; index -= 1) {
      const ask = book.asks[index];
      rows.push({
        side: "ASK",
        price: usd(ask.price),
        quantity: ask.quantity.toLocaleString("en-US", {
          maximumFractionDigits: 4,
        }),
        notional: usd(ask.notional, 2),
      });
    }
    for (const bid of book.bids) {
      rows.push({
        side: "BID",
        price: usd(bid.price),
        quantity: bid.quantity.toLocaleString("en-US", {
          maximumFractionDigits: 4,
        }),
        notional: usd(bid.notional, 2),
      });
    }
    console.table(rows);
  }

  async candles(marketIndex = 0, interval = "1m", limit = 30) {
    const { source, symbol, candles } = await fetchCandles(
      marketIndex,
      interval,
      limit
    );
    const first = candles[0];
    const last = candles[candles.length - 1];
    const direction = last.close >= first.open ? "UP" : "DOWN";
    console.log(
      `\nCANDLESTICKS (${source}, ${symbol}, ${interval}, ${marketLabel(
        marketIndex
      )})`
    );
    console.log(
      `Window direction: ${direction} | open ${usd(first.open)} -> close ${usd(
        last.close
      )}`
    );
    printAsciiCandles(candles);
    console.table(
      candles.slice(-8).map((candle: any) => ({
        time: candle.time,
        open: usd(candle.open),
        high: usd(candle.high),
        low: usd(candle.low),
        close: usd(candle.close),
        volume: candle.volume.toLocaleString("en-US", {
          maximumFractionDigits: 2,
        }),
      }))
    );
  }

  async dashboard(marketIndex = 0) {
    await this.state();
    await this.marketData(marketIndex);
    await this.orderBook(marketIndex);
    await this.candles(marketIndex, "1m", 30);
  }

  async watch(marketIndex = 0, secondsText = "30", interval = "1m") {
    const seconds = Math.min(Math.max(Number(secondsText) || 30, 5), 300);
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      console.clear();
      await this.marketData(marketIndex).catch((error) =>
        console.error(`Market data error: ${error.message}`)
      );
      await this.candles(marketIndex, interval, 24).catch((error) =>
        console.error(`Candles error: ${error.message}`)
      );
      await this.positions().catch((error) =>
        console.error(`Positions error: ${error.message}`)
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  async state() {
    const accounts = this.pdas();
    const protocol: any = await this.protocol();
    const market: any = await this.market();
    const ownerTokenAccount = associatedTokenAddress(
      this.owner,
      new PublicKey(protocol.collateralMint)
    );
    const ownerBalance = await this.provider.connection
      .getTokenAccountBalance(ownerTokenAccount)
      .then((balance) => balance.value.uiAmountString)
      .catch(() => "no token account");
    const profile = await (this.program.account as any).traderProfile
      .fetch(accounts.traderProfile)
      .catch(() => null);
    const margin = await (this.program.account as any).marginAccount
      .fetch(accounts.marginAccount)
      .catch(() => null);

    console.log("\nREAL DEVNET STATE");
    console.log("Program:           ", this.program.programId.toBase58());
    console.log("Wallet:            ", this.owner.toBase58());
    console.log("Protocol PDA:      ", accounts.protocol.toBase58());
    console.log("Collateral mint:   ", protocol.collateralMint.toBase58());
    console.log("Collateral vault:  ", protocol.collateralVault.toBase58());
    console.log("Owner token acct:  ", ownerTokenAccount.toBase58());
    console.log("Wallet token bal:  ", ownerBalance);
    console.log("Next position ID:  ", protocol.nextPositionId.toString());
    console.log("Insurance fund:    ", ui(protocol.insuranceFundBalance));
    console.log("Trading paused:    ", protocol.tradingPaused);
    console.log("Market:            ", market.symbol);
    console.log("Oracle enabled:    ", market.oracleEnabled);
    console.log(
      "Mark price:        ",
      priceUi(market.price, market.priceDecimals)
    );
    console.log("Last price slot:   ", market.lastPriceUpdateSlot.toString());
    if (margin) {
      console.log("Margin balance:    ", ui((margin as any).collateralBalance));
      console.log("Locked collateral: ", ui((margin as any).lockedCollateral));
    } else {
      console.log("Margin account:    not initialized");
    }
    if (profile) {
      console.log(
        "Reputation score:  ",
        (profile as any).reputationScore.toString()
      );
      console.log(
        "Total trades:      ",
        (profile as any).totalTrades.toString()
      );
      console.log(
        "Wins/Losses/Liqs:  ",
        `${(profile as any).winningTrades}/${(profile as any).losingTrades}/${
          (profile as any).liquidations
        }`
      );
      console.log(
        "Realized PnL:      ",
        (profile as any).realizedPnl.toString()
      );
    } else {
      console.log("Trader profile:    not initialized");
    }
  }

  async walletInfo() {
    const protocol: any = await this.protocol();
    const tokenAccount = associatedTokenAddress(
      this.owner,
      new PublicKey(protocol.collateralMint)
    );
    const solBalance = await this.provider.connection.getBalance(this.owner);
    const tokenBalance = await this.provider.connection
      .getTokenAccountBalance(tokenAccount)
      .then((balance) => balance.value.uiAmountString)
      .catch(() => "no token account");
    console.log("\nCONNECTED WALLET");
    console.log("Wallet address:    ", this.owner.toBase58());
    console.log(
      "SOL balance:       ",
      `${(solBalance / 1_000_000_000).toFixed(6)} SOL`
    );
    console.log("Collateral mint:   ", protocol.collateralMint.toBase58());
    console.log("Token account:     ", tokenAccount.toBase58());
    console.log("Token balance:     ", tokenBalance);
    console.log(
      "Signer source:     ",
      process.env.ANCHOR_WALLET ??
        process.env.WALLET ??
        "default Solana CLI wallet"
    );
  }

  help() {
    console.log(`
Commands call the real ReputeX Anchor program on devnet.

  state                         Show real protocol, market, wallet, profile, margin
  dashboard [market]            Show on-chain state + real market data + book + candles
  market [market]               Show live market data, example: market 0
  book [market]                 Show live reference order book, example: book 1
  candles [market] [interval]   Show live candles, example: candles 0 1m 40
  watch [market] [seconds]      Refresh market/candles/positions every 5 seconds
  connect                       Show connected keypair wallet and balances
  ata                           Create/check your SPL collateral token account
  mint <amount>                 Mint test collateral to this wallet (devnet authority wallet)
  profile                       Create trader profile and margin account
  deposit <amount>              Deposit collateral into protocol vault
  fund <amount>                 Fund protocol insurance from wallet collateral
  refresh                       Refresh SOL-PERP price from Pyth
  open long <collateral> <lev>  Open long, example: open long 1 2
  open short <collateral> <lev> Open short, example: open short 1 2
  positions                     List this wallet's on-chain position accounts
  close <position_id>           Close a position, example: close 2
  withdraw <amount>             Withdraw free collateral to wallet token account
  help                          Show commands
  exit                          Quit

Amounts are UI collateral tokens. With 6 decimals, "1" means 1.000000 token.
Market ids: 0 SOL, 1 BTC, 2 ETH, 3 JUP. On-chain trading is currently SOL-PERP only.
Use a small amount for demos, for example: mint 20, deposit 10, fund 5, open long 1 2.
`);
  }

  async handle(input: string) {
    const [command = "", ...args] = input.trim().split(/\s+/);
    try {
      switch (command.toLowerCase()) {
        case "":
          return;
        case "help":
          this.help();
          return;
        case "state":
          await this.state();
          return;
        case "dashboard":
          await this.dashboard(numericArg(args[0], 0));
          return;
        case "market":
        case "price":
          await this.marketData(numericArg(args[0], 0));
          return;
        case "book":
        case "orderbook":
          await this.orderBook(numericArg(args[0], 0));
          return;
        case "candles":
        case "chart": {
          const parsed = parseMarketCommand(args);
          await this.candles(
            parsed.marketIndex,
            parsed.rest[0] ?? "1m",
            numericArg(parsed.rest[1], 30)
          );
          return;
        }
        case "watch":
          await this.watch(
            numericArg(args[0], 0),
            args[1] ?? "30",
            args[2] ?? "1m"
          );
          return;
        case "connect":
        case "wallet":
          await this.walletInfo();
          return;
        case "ata":
          await this.ensureAta();
          return;
        case "mint":
          await this.mint(args[0] ?? "10");
          return;
        case "profile":
          await this.createProfile();
          return;
        case "deposit":
          await this.deposit(args[0] ?? "1");
          return;
        case "fund":
          await this.fund(args[0] ?? "1");
          return;
        case "refresh":
          await this.refresh();
          return;
        case "open":
          await this.open(args[0] ?? "long", args[1] ?? "1", args[2] ?? "2");
          return;
        case "positions":
          await this.positions();
          return;
        case "close":
          await this.close(args[0] ?? "");
          return;
        case "withdraw":
          await this.withdraw(args[0] ?? "1");
          return;
        case "exit":
        case "quit":
          rl.close();
          process.exit(0);
        default:
          console.log(`Unknown command: ${command}. Type help.`);
      }
    } catch (error: any) {
      console.error(error?.message ?? error);
    }
  }

  async loop() {
    console.log("ReputeX real devnet terminal");
    console.log(`Wallet: ${this.owner.toBase58()}`);
    this.help();
    await this.state().catch((error) => console.error(error.message));
    while (true) {
      const command = await ask("\nreputex-devnet> ");
      await this.handle(command);
    }
  }
}

async function main() {
  const terminal = new LiveTerminal();
  const onceIndex = process.argv.indexOf("--once");
  if (onceIndex >= 0) {
    await terminal.handle(process.argv.slice(onceIndex + 1).join(" "));
    rl.close();
    return;
  }
  await terminal.loop();
}

main().catch((error) => {
  console.error(error);
  rl.close();
  process.exit(1);
});
