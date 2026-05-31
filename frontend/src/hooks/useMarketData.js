import { useEffect, useMemo, useState } from "react";

const COINGECKO_MARKETS_URL =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=solana,bitcoin,ethereum,jupiter-exchange-solana&order=market_cap_desc&per_page=20&page=1&sparkline=true&price_change_percentage=1h,24h,7d";

const marketIds = {
  "SOL-PERP": "solana",
  "BTC-PERP": "bitcoin",
  "ETH-PERP": "ethereum",
  "JUP-PERP": "jupiter-exchange-solana",
};

const fallbackQuotes = {
  "SOL-PERP": { id: "solana", name: "Solana" },
  "BTC-PERP": { id: "bitcoin", name: "Bitcoin" },
  "ETH-PERP": { id: "ethereum", name: "Ethereum" },
  "JUP-PERP": { id: "jupiter-exchange-solana", name: "Jupiter" },
};

function normalizeCoin(coin) {
  return {
    id: coin.id,
    name: coin.name,
    symbol: coin.symbol?.toUpperCase(),
    price: coin.current_price,
    change1h: coin.price_change_percentage_1h_in_currency,
    change24h: coin.price_change_percentage_24h_in_currency ?? coin.price_change_percentage_24h,
    change7d: coin.price_change_percentage_7d_in_currency,
    volume24h: coin.total_volume,
    high24h: coin.high_24h,
    low24h: coin.low_24h,
    marketCap: coin.market_cap,
    rank: coin.market_cap_rank,
    image: coin.image,
    sparkline: coin.sparkline_in_7d?.price?.filter((point) => Number.isFinite(point)) ?? [],
    updatedAt: coin.last_updated ? new Date(coin.last_updated) : new Date(),
    source: "CoinGecko",
  };
}

export function useMarketData(refreshMs = 45_000) {
  const [quotes, setQuotes] = useState({});
  const [status, setStatus] = useState("Loading live market data...");
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(COINGECKO_MARKETS_URL, {
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(`CoinGecko returned ${response.status}`);
        const payload = await response.json();
        if (cancelled) return;
        const byId = Object.fromEntries(payload.map((coin) => [coin.id, normalizeCoin(coin)]));
        const nextQuotes = Object.fromEntries(
          Object.entries(marketIds).map(([symbol, id]) => [
            symbol,
            byId[id] ?? {
              ...fallbackQuotes[symbol],
              source: "Unavailable",
              sparkline: [],
              updatedAt: new Date(),
            },
          ])
        );
        setQuotes(nextQuotes);
        setLastUpdated(new Date());
        setStatus("Live market data");
      } catch (error) {
        if (cancelled) return;
        setStatus(`Market data unavailable: ${error.message}`);
      }
    };

    load();
    const timer = window.setInterval(load, refreshMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshMs]);

  return useMemo(() => ({ quotes, status, lastUpdated }), [lastUpdated, quotes, status]);
}
