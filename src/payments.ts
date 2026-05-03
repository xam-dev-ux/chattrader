import { parseUnits, formatUnits } from "viem";
import { publicClient } from "./wallet.js";
import { USDC_ADDRESS } from "./constants/contracts.js";
import { logTransaction } from "./transactions.js";

const TRANSFER_EVENT_ABI = [{
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
}] as const;

type PendingPayment = {
  intent: string;
  expiresAt: number;
  fromAddress: string;
  amountUSDC: number;
  resolve: () => void;
};

const pendingPayments = new Map<string, PendingPayment>();

export function setPendingPayment(
  conversationId: string,
  payment: Omit<PendingPayment, "resolve">,
  onConfirmed: () => void
): void {
  pendingPayments.set(conversationId, { ...payment, resolve: onConfirmed });
  setTimeout(() => pendingPayments.delete(conversationId), 5 * 60 * 1000);
}

export function hasPendingPayment(conversationId: string): boolean {
  return pendingPayments.has(conversationId);
}

export async function verifyAndConfirmPayment(
  conversationId: string
): Promise<boolean> {
  const pending = pendingPayments.get(conversationId);
  if (!pending) return false;
  if (Date.now() > pending.expiresAt) {
    pendingPayments.delete(conversationId);
    return false;
  }

  const botAddress = process.env.BOT_ADDRESS as `0x${string}`;
  const expectedAmount = parseUnits(pending.amountUSDC.toString(), 6);

  try {
    const logs = await publicClient.getLogs({
      address: USDC_ADDRESS,
      event: TRANSFER_EVENT_ABI[0],
      args: {
        from: pending.fromAddress as `0x${string}`,
        to: botAddress,
      },
      fromBlock: "latest",
    });

    const match = logs.find((log) => {
      const val = (log.args as { value?: bigint }).value ?? 0n;
      return val >= expectedAmount;
    });

    if (match) {
      logTransaction({
        type: "payment_received",
        txHash: match.transactionHash ?? "0x",
        amountIn: pending.amountUSDC,
        tokenIn: "USDC",
        from: pending.fromAddress,
        timestamp: Date.now(),
        status: "confirmed",
      });
      pending.resolve();
      pendingPayments.delete(conversationId);
      return true;
    }
  } catch (err) {
    console.error("[payments] verify error:", err);
  }

  return false;
}

export function watchIncomingPayments(): void {
  const botAddress = process.env.BOT_ADDRESS as `0x${string}`;

  publicClient.watchContractEvent({
    address: USDC_ADDRESS,
    abi: TRANSFER_EVENT_ABI,
    eventName: "Transfer",
    args: { to: botAddress },
    onLogs: (logs) => {
      for (const log of logs) {
        const args = log.args as { from?: string; value?: bigint };
        const amount = Number(formatUnits(args.value ?? 0n, 6));
        console.log(`[payments] incoming ${amount} USDC from ${args.from}`);
        logTransaction({
          type: "payment_received",
          txHash: log.transactionHash ?? "0x",
          amountIn: amount,
          tokenIn: "USDC",
          from: args.from,
          timestamp: Date.now(),
          status: "confirmed",
        });
      }
    },
  });
}
