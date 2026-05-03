const COINCAP_ID: Record<string, string> = {
  eth: "ethereum",
  btc: "bitcoin",
  sol: "solana",
  doge: "dogecoin",
};

const BINANCE_SYMBOL: Record<string, string> = {
  eth: "ETHUSDT",
  btc: "BTCUSDT",
  sol: "SOLUSDT",
  doge: "DOGEUSDT",
};

// kept for the CoinGecko fallback
const COINGECKO_ID = COINCAP_ID;

export type PriceData = {
  usd: number;
  usd_24h_change: number;
};

export async function getPrice(token: string): Promise<PriceData | null> {
  const key = token.toLowerCase();
  const capId = COINCAP_ID[key];
  const binanceSymbol = BINANCE_SYMBOL[key];
  if (!capId) return null;

  // 1. CoinCap — no key, no rate limits
  try {
    const res = await fetch(`https://api.coincap.io/v2/assets/${capId}`);
    if (res.ok) {
      const j = await res.json() as { data?: { priceUsd: string; changePercent24Hr: string } };
      const d = j.data;
      if (d?.priceUsd) {
        console.log(`[price] CoinCap ok: ${key} $${parseFloat(d.priceUsd).toFixed(2)}`);
        return { usd: parseFloat(d.priceUsd), usd_24h_change: parseFloat(d.changePercent24Hr ?? "0") };
      }
    }
    console.warn(`[price] CoinCap ${capId} status=${res.status}`);
  } catch (e) { console.warn(`[price] CoinCap error:`, (e as Error).message); }

  // 2. Binance public ticker (no key needed)
  if (binanceSymbol) {
    try {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbol}`);
      if (res.ok) {
        const d = await res.json() as { lastPrice: string; priceChangePercent: string };
        if (d?.lastPrice) {
          console.log(`[price] Binance ok: ${key} $${parseFloat(d.lastPrice).toFixed(2)}`);
          return { usd: parseFloat(d.lastPrice), usd_24h_change: parseFloat(d.priceChangePercent ?? "0") };
        }
      }
      console.warn(`[price] Binance ${binanceSymbol} status=${res.status}`);
    } catch (e) { console.warn(`[price] Binance error:`, (e as Error).message); }
  }

  // 3. CoinGecko free tier (may be blocked on cloud IPs)
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${COINGECKO_ID[key]}&vs_currencies=usd&include_24hr_change=true`
    );
    if (res.ok) {
      const j = await res.json() as Record<string, { usd?: number; usd_24h_change?: number }>;
      const d = j[COINGECKO_ID[key]];
      if (d?.usd) {
        console.log(`[price] CoinGecko ok: ${key} $${d.usd}`);
        return { usd: d.usd, usd_24h_change: d.usd_24h_change ?? 0 };
      }
    }
    console.warn(`[price] CoinGecko status=${res.status}`);
  } catch (e) { console.warn(`[price] CoinGecko error:`, (e as Error).message); }

  console.error(`[price] all providers failed for ${key}`);
  return null;
}
