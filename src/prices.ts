const TOKEN_MAP: Record<string, string> = {
  eth: "ethereum",
  btc: "bitcoin",
  sol: "solana",
  doge: "dogecoin",
};

export type PriceData = {
  usd: number;
  usd_24h_change: number;
};

export async function getPrice(token: string): Promise<PriceData | null> {
  const coinId = TOKEN_MAP[token.toLowerCase()];
  if (!coinId) return null;

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json() as Record<string, PriceData>;
  return data[coinId] ?? null;
}
