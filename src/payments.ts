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
  receivedUSDC?: number;  // cumulative received in this window
  resolve: () => void;
};

const pendingPayments = new Map<string, PendingPayment>();

export function setPendingPayment(
  conversationId: string,
  payment: Omit<PendingPayment, "resolve">,
  onConfirmed: () => void
): void {
  pendingPayments.set(conversationId, { ...payment, receivedUSDC: 0, resolve: onConfirmed });
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

    // Sum all transfers to bot in the window — accept partial sends
    const totalReceived = logs.reduce((sum, log) => {
      return sum + ((log.args as { value?: bigint }).value ?? 0n);
    }, 0n);
    console.log(`[payments] total received in window: ${formatUnits(totalReceived, 6)} USDC (need ${pending.amountUSDC})`);
    const match = totalReceived >= expectedAmount ? logs[logs.length - 1] : undefined;

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

// mainnet.base.org does not support eth_newFilter/eth_getFilterChanges,
// so we poll getLogs manually instead of using watchContractEvent.
export async function watchIncomingPayments(): Promise<void> {
  const botAddress = process.env.BOT_ADDRESS as `0x${string}`;
  let lastBlock = await publicClient.getBlockNumber();
  console.log(`[payments] polling USDC transfers to ${botAddress} from block ${lastBlock}`);

  setInterval(async () => {
    try {
      const currentBlock = await publicClient.getBlockNumber();
      if (currentBlock <= lastBlock) return;

      const logs = await publicClient.getLogs({
        address: USDC_ADDRESS,
        event: TRANSFER_EVENT_ABI[0],
        args: { to: botAddress },
        fromBlock: lastBlock + 1n,
        toBlock: currentBlock,
      });

      lastBlock = currentBlock;

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
        // Accumulate across multiple transfers so partial sends still count
        for (const [convId, pending] of pendingPayments) {
          pending.receivedUSDC = (pending.receivedUSDC ?? 0) + amount;
          console.log(`[payments] conv=${convId} received=${pending.receivedUSDC?.toFixed(6)}/${pending.amountUSDC} USDC`);
          if ((pending.receivedUSDC ?? 0) >= pending.amountUSDC) {
            console.log(`[payments] auto-confirming conv=${convId} intent=${pending.intent}`);
            pending.resolve();
            pendingPayments.delete(convId);
          }
        }
      }
    } catch (err) {
      console.error("[payments] poll error:", err);
    }
  }, 5000);
}
