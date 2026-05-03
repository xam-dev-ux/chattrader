import { readFileSync, writeFileSync } from "node:fs";

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

const TX_FILE = "/tmp/chattrader-txlog.json";
const MAX_TXS = 200;

function loadFromDisk(): Transaction[] {
  try {
    return JSON.parse(readFileSync(TX_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveToDisk(txs: Transaction[]): void {
  try {
    writeFileSync(TX_FILE, JSON.stringify(txs));
  } catch (e) {
    console.error("[txlog] disk write error:", e);
  }
}

const txLog: Transaction[] = loadFromDisk();

export function logTransaction(tx: Transaction): void {
  txLog.unshift(tx);
  if (txLog.length > MAX_TXS) txLog.pop();
  saveToDisk(txLog);
  console.log(`[txlog] ${tx.type} ${tx.txHash} ${tx.amountIn ?? ""}${tx.tokenIn ?? ""} status:${tx.status}`);
}

export function getTransactions(): Transaction[] {
  return txLog;
}
