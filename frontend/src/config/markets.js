export const PROGRAM_ID = "EcKorS8y9kXHXQDjzN9eBYuhKqtdDFhypD9ceYfFKpfH";
export const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
export const DEFAULT_IDL_PATH = "/idl/reputex.json";

export const markets = [
  {
    symbol: "SOL-PERP",
    base: "SOL",
    price: 158.42,
    funding: 0.012,
    change: 2.34,
    maxLev: 5,
    oracle: "Pyth SOL/USD",
  },
  {
    symbol: "BTC-PERP",
    base: "BTC",
    price: 68480,
    funding: -0.004,
    change: -0.86,
    maxLev: 5,
    oracle: "Coming soon",
  },
  {
    symbol: "ETH-PERP",
    base: "ETH",
    price: 3742,
    funding: 0.008,
    change: 1.18,
    maxLev: 5,
    oracle: "Coming soon",
  },
  {
    symbol: "JUP-PERP",
    base: "JUP",
    price: 1.17,
    funding: 0.021,
    change: 4.73,
    maxLev: 4,
    oracle: "Coming soon",
  },
];

export const startingProfile = {
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  liquidations: 0,
  totalVolume: 0,
  realizedPnl: 0,
  avgLeverageX100: 0,
  reputationScore: 100,
};
