export type Transaction = {
  type: "swap" | "payment_received" | "payment_sent";
  txHash: string;
  amountIn?: number;
  amountOut?: number;
  tokenIn?: string;
  tokenOut?: string;
  from?: string;
  timestamp: number;
  builderCode?: string;
  status: "confirmed" | "pending" | "failed";
};

const txLog: Transaction[] = [];
const MAX_TXS = 200;

export function logTransaction(tx: Transaction): void {
  txLog.unshift(tx);
  if (txLog.length > MAX_TXS) txLog.pop();
}

export function getTransactions(): Transaction[] {
  return txLog;
}
