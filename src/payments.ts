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
  setTimeout(() => {
    if (pendingPayments.has(conversationId)) {
      console.log(`[payments] pending expired for conv ${conversationId}`);
      pendingPayments.delete(conversationId);
    }
  }, 5 * 60 * 1000);
  console.log(`[payments] pending set: conv=${conversationId} intent=${payment.intent} amount=${payment.amountUSDC} USDC expires=${new Date(payment.expiresAt).toISOString()}`);
}

export function hasPendingPayment(conversationId: string): boolean {
  return pendingPayments.has(conversationId);
}

export async function verifyAndConfirmPayment(
  conversationId: string
): Promise<boolean> {
  const pending = pendingPayments.get(conversationId);
  if (!pending) {
    console.log(`[payments] no pending payment for conv ${conversationId}`);
    return false;
  }
  if (Date.now() > pending.expiresAt) {
    console.log(`[payments] payment expired for conv ${conversationId}`);
    pendingPayments.delete(conversationId);
    return false;
  }

  const botAddress = process.env.BOT_ADDRESS as `0x${string}`;
  const expectedAmount = parseUnits(pending.amountUSDC.toString(), 6);
  console.log(`[payments] verifying: conv=${conversationId} expected=${pending.amountUSDC} USDC botAddress=${botAddress}`);

  try {
    // Look back ~600 blocks (~20 min on Base). No `from` filter because
    // senderInboxId is an XMTP identity, not the user's wallet address.
    const currentBlock = await publicClient.getBlockNumber();
    const fromBlock = currentBlock > 600n ? currentBlock - 600n : 0n;
    console.log(`[payments] getLogs fromBlock=${fromBlock} toBlock=latest`);

    const logs = await publicClient.getLogs({
      address: USDC_ADDRESS,
      event: TRANSFER_EVENT_ABI[0],
      args: { to: botAddress },
      fromBlock,
      toBlock: "latest",
    });

    console.log(`[payments] found ${logs.length} USDC transfers to bot`);
    for (const log of logs) {
      const val = (log.args as { value?: bigint }).value ?? 0n;
      console.log(`[payments]   tx=${log.transactionHash} value=${formatUnits(val, 6)} USDC (need ${pending.amountUSDC})`);
    }

    const match = logs.find((log) => {
      const val = (log.args as { value?: bigint }).value ?? 0n;
      return val >= expectedAmount;
    });

    if (match) {
      const matchVal = (match.args as { value?: bigint }).value ?? 0n;
      console.log(`[payments] MATCH found tx=${match.transactionHash} value=${formatUnits(matchVal, 6)} USDC`);
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

    console.log(`[payments] no matching transfer found for ${pending.amountUSDC} USDC`);
  } catch (err) {
    console.error("[payments] verify error:", err);
  }

  return false;
}

export function watchIncomingPayments(): void {
  const botAddress = process.env.BOT_ADDRESS as `0x${string}`;
  console.log(`[payments] watching incoming USDC to ${botAddress}`);

  publicClient.watchContractEvent({
    address: USDC_ADDRESS,
    abi: TRANSFER_EVENT_ABI,
    eventName: "Transfer",
    args: { to: botAddress },
    onLogs: (logs) => {
      for (const log of logs) {
        const args = log.args as { from?: string; value?: bigint };
        const amount = Number(formatUnits(args.value ?? 0n, 6));
        console.log(`[payments] INCOMING ${amount} USDC from ${args.from} tx=${log.transactionHash}`);
        logTransaction({
          type: "payment_received",
          txHash: log.transactionHash ?? "0x",
          amountIn: amount,
          tokenIn: "USDC",
          from: args.from,
          timestamp: Date.now(),
          status: "confirmed",
        });
        // Auto-resolve any pending payment whose expected amount matches
        for (const [convId, pending] of pendingPayments) {
          const expected = parseUnits(pending.amountUSDC.toString(), 6);
          if ((args.value ?? 0n) >= expected) {
            console.log(`[payments] auto-confirming conv=${convId} intent=${pending.intent}`);
            pending.resolve();
            pendingPayments.delete(convId);
          }
        }
      }
    },
    onError: (err) => {
      console.error("[payments] watchContractEvent error:", err);
    },
  });
}
