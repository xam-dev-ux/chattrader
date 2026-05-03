export type Intent =
  | { type: "price"; token: string }
  | { type: "analysis"; token: string }
  | { type: "swap"; amount: number }
  | { type: "balance" }
  | { type: "help" }
  | { type: "confirm" }
  | { type: "unknown" };

export function parseIntent(text: string): Intent {
  const t = text.trim().toLowerCase();

  if (/^(confirm|done|paid|yes)$/.test(t)) return { type: "confirm" };
  if (/^help$/.test(t)) return { type: "help" };
  if (/^(my\s+)?balance$/.test(t)) return { type: "balance" };

  const priceMatch = t.match(/^price\s+(of\s+)?(\w+)$/) ?? t.match(/^(\w+)\s+price$/);
  if (priceMatch) return { type: "price", token: priceMatch[priceMatch.length - 1] };

  const analyzeMatch = t.match(/^analy[sz]e?\s+(\w+)$/);
  if (analyzeMatch) return { type: "analysis", token: analyzeMatch[1] };

  const swapMatch = t.match(/^swap\s+(\d+(?:\.\d+)?)\s+usdc(\s+to\s+eth)?$/);
  if (swapMatch) return { type: "swap", amount: parseFloat(swapMatch[1]) };

  return { type: "unknown" };
}
