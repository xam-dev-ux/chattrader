import http from "node:http";
import { Client } from "@xmtp/node-sdk";
import { account, walletClient, publicClient } from "./wallet.js";
import { parseIntent } from "./handler.js";
import { getPrice } from "./prices.js";
import { executeSwap } from "./swap.js";
import { getTransactions } from "./transactions.js";
import {
  setPendingPayment,
  hasPendingPayment,
  verifyAndConfirmPayment,
  watchIncomingPayments,
} from "./payments.js";
import { BUILDER_CODE } from "./constants/builderCode.js";
import { formatUnits } from "viem";
import { USDC_ADDRESS } from "./constants/contracts.js";

const START_TIME = Date.now();
const PORT = Number(process.env.PORT ?? 3000);
const BOT_ADDRESS = process.env.BOT_ADDRESS ?? account.address;
const VERCEL_URL = process.env.VERCEL_URL ?? "https://chattrader.vercel.app";
const PRICE_PER_ANALYSIS = Number(process.env.PRICE_PER_ANALYSIS ?? 0.01);
const MIN_SWAP_USDC = Number(process.env.MIN_SWAP_USDC ?? 5);
const SWAP_FEE_USDC = 0.02;

const USDC_ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ── HTTP server ──────────────────────────────────────────────────────────────

function cors(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

  const url = req.url ?? "/";

  if (url === "/health") {
    return json(res, { status: "ok", address: BOT_ADDRESS, uptime: Math.floor((Date.now() - START_TIME) / 1000) });
  }

  if (url === "/api/transactions") {
    return json(res, { transactions: getTransactions(), botAddress: BOT_ADDRESS, builderCode: BUILDER_CODE });
  }

  if (url === "/api/stats") {
    const txs = getTransactions();
    const swaps = txs.filter((t) => t.type === "swap");
    const payments = txs.filter((t) => t.type === "payment_received");
    return json(res, {
      totalSwaps: swaps.length,
      totalVolumeUSDC: swaps.reduce((s, t) => s + (t.amountIn ?? 0), 0),
      totalPaymentsReceived: payments.length,
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      botAddress: BOT_ADDRESS,
      builderCode: BUILDER_CODE,
    });
  }

  json(res, { error: "not found" }, 404);
});

server.listen(PORT, () => console.log(`[server] listening on :${PORT}`));

// ── XMTP stream ──────────────────────────────────────────────────────────────

async function handleMessage(message: {
  senderAddress?: string;
  content: string;
  conversationId?: string;
  conversation?: { send: (text: string) => Promise<void> };
}): Promise<void> {
  const sender = message.senderAddress ?? "";
  const text = typeof message.content === "string" ? message.content : "";
  const convId = message.conversationId ?? sender;
  const send = async (reply: string) => {
    await message.conversation?.send(reply);
  };

  const intent = parseIntent(text);

  if (intent.type === "confirm" && hasPendingPayment(convId)) {
    await send("Verifying payment onchain...");
    const ok = await verifyAndConfirmPayment(convId);
    if (!ok) await send("Payment not found yet. Please wait a moment and try again, or send a new payment.");
    return;
  }

  switch (intent.type) {
    case "help": {
      await send(
        `CHATTRADER 🤖\nFree: price [token] · my balance · help\nPremium ($${PRICE_PER_ANALYSIS}): analyze [token]\nSwap ($${SWAP_FEE_USDC} fee): swap [amount] usdc to eth\nPay to: ${BOT_ADDRESS}\nDashboard: ${VERCEL_URL}`
      );
      break;
    }

    case "price": {
      const data = await getPrice(intent.token);
      if (!data) {
        await send(`Unknown token: ${intent.token}. Supported: eth, btc, sol, doge`);
      } else {
        const change = data.usd_24h_change.toFixed(2);
        const sign = data.usd_24h_change >= 0 ? "+" : "";
        await send(`${intent.token.toUpperCase()}: $${data.usd.toLocaleString()} (${sign}${change}% 24h)`);
      }
      break;
    }

    case "balance": {
      try {
        const raw = await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: USDC_ERC20_ABI,
          functionName: "balanceOf",
          args: [BOT_ADDRESS as `0x${string}`],
        });
        const usdc = Number(formatUnits(raw as bigint, 6)).toFixed(2);
        const eth = await publicClient.getBalance({ address: BOT_ADDRESS as `0x${string}` });
        const ethFormatted = Number(formatUnits(eth, 18)).toFixed(6);
        await send(`Bot balance:\nUSDC: ${usdc}\nETH: ${ethFormatted}`);
      } catch {
        await send("Could not fetch balance.");
      }
      break;
    }

    case "analysis": {
      await send(`Analysis of ${intent.token.toUpperCase()} costs $${PRICE_PER_ANALYSIS} USDC.\nSend ${PRICE_PER_ANALYSIS} USDC to ${BOT_ADDRESS}\nThen reply: confirm`);
      setPendingPayment(
        convId,
        { intent: `analysis:${intent.token}`, fromAddress: sender, amountUSDC: PRICE_PER_ANALYSIS, expiresAt: Date.now() + 5 * 60 * 1000 },
        async () => {
          const data = await getPrice(intent.token);
          if (!data) { await send("Could not fetch data for analysis."); return; }
          const change = data.usd_24h_change;
          const sentiment = change > 2 ? "bullish" : change < -2 ? "bearish" : "neutral";
          await send(
            `${intent.token.toUpperCase()} ANALYSIS\nPrice: $${data.usd.toLocaleString()}\n24h: ${change.toFixed(2)}%\nSentiment: ${sentiment.toUpperCase()}\n${change > 0 ? "Momentum positive — watch for resistance levels." : "Selling pressure present — monitor support zones."}`
          );
        }
      );
      break;
    }

    case "swap": {
      if (intent.amount < MIN_SWAP_USDC) {
        await send(`Minimum swap is ${MIN_SWAP_USDC} USDC.`);
        break;
      }
      const totalCost = intent.amount + SWAP_FEE_USDC;
      await send(`Swap ${intent.amount} USDC → ETH (fee: $${SWAP_FEE_USDC} USDC)\nTotal: ${totalCost} USDC\nSend to: ${BOT_ADDRESS}\nReply: confirm`);
      setPendingPayment(
        convId,
        { intent: `swap:${intent.amount}`, fromAddress: sender, amountUSDC: totalCost, expiresAt: Date.now() + 5 * 60 * 1000 },
        async () => {
          try {
            await send("Payment confirmed! Executing swap...");
            const txHash = await executeSwap(intent.amount, sender as `0x${string}`);
            await send(`Swap executed!\nTx: ${txHash}\nView: https://basescan.org/tx/${txHash}`);
          } catch (err) {
            await send(`Swap failed: ${(err as Error).message}`);
          }
        }
      );
      break;
    }

    default:
      await send('I didn\'t understand that. Type "help" to see available commands.');
  }
}

async function startXmtp(): Promise<void> {
  const client = await Client.create(account, { env: "production" });
  console.log(`[xmtp] bot address: ${client.accountAddress}`);

  while (true) {
    try {
      const stream = await client.conversations.streamAllMessages();
      for await (const message of stream) {
        if (!message) continue;
        const sender = (message as { senderAddress?: string }).senderAddress ?? "";
        if (sender.toLowerCase() === account.address.toLowerCase()) continue;
        handleMessage(message as Parameters<typeof handleMessage>[0]).catch((e) =>
          console.error("[handler] error:", e)
        );
      }
    } catch (err) {
      console.error("[xmtp] stream error, restarting in 5s:", err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

watchIncomingPayments();
startXmtp().catch((e) => { console.error("[xmtp] fatal:", e); process.exit(1); });
