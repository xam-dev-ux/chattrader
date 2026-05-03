export type PriceData = {
  usd: number;
  usd_24h_change: number;
};

const CC_SYMBOL: Record<string, string> = {
  eth: "ETH",
  btc: "BTC",
  sol: "SOL",
  doge: "DOGE",
};

const KRAKEN_PAIR: Record<string, string> = {
  eth: "ETHUSD",
  btc: "XBTUSD",
  sol: "SOLUSD",
  doge: "XDGUSD",
};

export async function getPrice(token: string): Promise<PriceData | null> {
  const key = token.toLowerCase();
  if (!CC_SYMBOL[key]) return null;

  // 1. CryptoCompare — free, no key, works from cloud
  try {
    const sym = CC_SYMBOL[key];
    const res = await fetch(
      `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${sym}&tsyms=USD`
    );
    if (res.ok) {
      const j = await res.json() as { RAW?: Record<string, { USD?: { PRICE: number; CHANGEPCT24HOUR: number } }> };
      const d = j.RAW?.[sym]?.USD;
      if (d?.PRICE) {
        console.log(`[price] CryptoCompare ok: ${key} $${d.PRICE.toFixed(2)}`);
        return { usd: d.PRICE, usd_24h_change: d.CHANGEPCT24HOUR ?? 0 };
      }
    }
    console.warn(`[price] CryptoCompare ${sym} status=${res.status}`);
  } catch (e) { console.warn(`[price] CryptoCompare error:`, (e as Error).message); }

  // 2. Kraken — very reliable, global, no key
  try {
    const pair = KRAKEN_PAIR[key];
    const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pair}`);
    if (res.ok) {
      const j = await res.json() as { result?: Record<string, { c: string[]; P: string[] }> };
      const result = j.result;
      if (result) {
        const ticker = Object.values(result)[0];
        if (ticker?.c?.[0]) {
          const price = parseFloat(ticker.c[0]);
          const change = parseFloat(ticker.P?.[1] ?? "0"); // 24h % change
          console.log(`[price] Kraken ok: ${key} $${price.toFixed(2)}`);
          return { usd: price, usd_24h_change: change };
        }
      }
    }
    console.warn(`[price] Kraken ${pair} status=${res.status}`);
  } catch (e) { console.warn(`[price] Kraken error:`, (e as Error).message); }

  // 3. CoinGecko — last resort (rate-limits cloud IPs)
  const GECKO_ID: Record<string, string> = { eth: "ethereum", btc: "bitcoin", sol: "solana", doge: "dogecoin" };
  try {
    const id = GECKO_ID[key];
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`
    );
    if (res.ok) {
      const j = await res.json() as Record<string, { usd?: number; usd_24h_change?: number }>;
      const d = j[id];
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
