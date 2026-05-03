import http from "node:http";
import { randomUUID } from "node:crypto";
import { Client, IdentifierKind } from "@xmtp/node-sdk";
import { toBytes, keccak256, formatUnits } from "viem";
import { account, publicClient } from "./wallet.js";
import { parseIntent } from "./handler.js";
import { getPrice } from "./prices.js";
import { executeSwap } from "./swap.js";
import { getTransactions } from "./transactions.js";
import { build402Header, settleX402Payment } from "./x402.js";
import { BUILDER_CODE_RAW } from "./constants/builderCode.js";
import { USDC_ADDRESS } from "./constants/contracts.js";

const START_TIME = Date.now();
const PORT = Number(process.env.PORT ?? 3000);
const BOT_ADDRESS = process.env.BOT_ADDRESS ?? account.address;
const BOT_URL = process.env.BOT_URL ?? "https://chattrader.onrender.com";
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

// ── Pending x402 callbacks ────────────────────────────────────────────────────

type PendingX402Entry =
  | { type: "analysis"; token: string; send: (text: string) => Promise<void> }
  | { type: "swap"; amount: number; send: (text: string) => Promise<void> };

const pendingX402 = new Map<string, PendingX402Entry>();

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function cors(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-PAYMENT,X-PAYMENT-REQUIRED");
  res.setHeader("Access-Control-Expose-Headers", "X-PAYMENT-REQUIRED");
}

function json(res: http.ServerResponse, data: unknown, status = 200, extra?: Record<string, string>): void {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json", ...extra });
  res.end(JSON.stringify(data));
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (pathname === "/health") {
    return json(res, { status: "ok", address: BOT_ADDRESS, uptime: Math.floor((Date.now() - START_TIME) / 1000) });
  }

  if (pathname === "/api/transactions") {
    return json(res, { transactions: getTransactions(), botAddress: BOT_ADDRESS, builderCode: BUILDER_CODE_RAW });
  }

  if (pathname === "/api/stats") {
    const txs = getTransactions();
    const swaps = txs.filter((t) => t.type === "swap");
    const payments = txs.filter((t) => t.type === "payment_received");
    return json(res, {
      totalSwaps: swaps.length,
      totalVolumeUSDC: swaps.reduce((s, t) => s + (t.amountIn ?? 0), 0),
      totalPaymentsReceived: payments.length,
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      botAddress: BOT_ADDRESS,
      builderCode: BUILDER_CODE_RAW,
    });
  }

  // ── x402: GET /api/analyze/:token?nonce=... ───────────────────────────────

  const analyzeMatch = pathname.match(/^\/api\/analyze\/([a-z]+)$/);
  if (analyzeMatch) {
    const token = analyzeMatch[1];
    const nonce = url.searchParams.get("nonce") ?? "";
    const xPayment = req.headers["x-payment"] as string | undefined;

    if (!xPayment) {
      const header402 = build402Header(PRICE_PER_ANALYSIS, BOT_ADDRESS, `Analysis of ${token.toUpperCase()}`);
      cors(res);
      res.writeHead(402, { "Content-Type": "application/json", "X-PAYMENT-REQUIRED": header402 });
      res.end(JSON.stringify({ error: "Payment required", amountUSDC: PRICE_PER_ANALYSIS }));
      return;
    }

    try {
      const settled = await settleX402Payment(xPayment);
      console.log(`[x402] analysis settled from=${settled.userAddress} tx=${settled.txHash}`);

      const data = await getPrice(token);
      let result: string;
      if (!data) {
        result = `Could not fetch data for ${token.toUpperCase()}.`;
      } else {
        const change = data.usd_24h_change;
        const sentiment = change > 2 ? "bullish" : change < -2 ? "bearish" : "neutral";
        result = `${token.toUpperCase()} ANALYSIS\nPrice: $${data.usd.toLocaleString()}\n24h: ${change.toFixed(2)}%\nSentiment: ${sentiment.toUpperCase()}\n${change > 0 ? "Momentum positive — watch resistance levels." : "Selling pressure — monitor support zones."}`;
      }

      const pending = pendingX402.get(nonce);
      if (pending?.type === "analysis") {
        pending.send(result).catch((e) => console.error("[x402] xmtp notify error:", e));
        pendingX402.delete(nonce);
      }

      return json(res, { analysis: result, txHash: settled.txHash });
    } catch (err) {
      console.error("[x402] analyze error:", err);
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  // ── x402: GET /api/swap/:amount?nonce=... ─────────────────────────────────

  const swapMatch = pathname.match(/^\/api\/swap\/([\d.]+)$/);
  if (swapMatch) {
    const amount = Number(swapMatch[1]);
    const nonce = url.searchParams.get("nonce") ?? "";
    const xPayment = req.headers["x-payment"] as string | undefined;
    const totalCost = Math.round((amount + SWAP_FEE_USDC) * 1e6) / 1e6;

    if (!xPayment) {
      const header402 = build402Header(totalCost, BOT_ADDRESS, `Swap ${amount} USDC → ETH`);
      cors(res);
      res.writeHead(402, { "Content-Type": "application/json", "X-PAYMENT-REQUIRED": header402 });
      res.end(JSON.stringify({ error: "Payment required", amountUSDC: totalCost }));
      return;
    }

    const pending = pendingX402.get(nonce);

    try {
      const settled = await settleX402Payment(xPayment);
      console.log(`[x402] swap settled from=${settled.userAddress} tx=${settled.txHash}`);

      const swapTx = await executeSwap(amount, settled.userAddress);
      const resultText = `Swap executed!\nTx: ${swapTx}\nView: https://basescan.org/tx/${swapTx}`;

      if (pending?.type === "swap") {
        pending.send(resultText).catch((e) => console.error("[x402] xmtp notify error:", e));
        pendingX402.delete(nonce);
      }

      return json(res, { txHash: swapTx, paymentTxHash: settled.txHash });
    } catch (err) {
      console.error("[x402] swap error:", err);
      if (pending) {
        pending.send(`Swap failed: ${(err as Error).message}`).catch(() => {});
        pendingX402.delete(nonce);
      }
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  json(res, { error: "not found" }, 404);
});

server.listen(PORT, () => console.log(`[server] listening on :${PORT}`));

// ── XMTP message handler ──────────────────────────────────────────────────────

async function handleMessage(opts: {
  senderInboxId: string;
  content: string;
  conversationId: string;
  send: (text: string) => Promise<void>;
}): Promise<void> {
  const { senderInboxId, content, send } = opts;
  const text = content.trim();
  const intent = parseIntent(text);
  console.log(`[handler] from=${senderInboxId.slice(0, 8)} intent=${intent.type} text="${text.slice(0, 60)}"`);

  switch (intent.type) {
    case "help":
      await send(
        `CHATTRADER 🤖\nFree: price [token] · my balance · help\nPremium ($${PRICE_PER_ANALYSIS}): analyze [token]\nSwap ($${SWAP_FEE_USDC} fee): swap [amount] usdc to eth\nPayment via x402 (crypto)\nDashboard: ${VERCEL_URL}`
      );
      break;

    case "price": {
      const data = await getPrice(intent.token);
      if (!data) {
        await send(`Unknown token: ${intent.token}. Supported: eth, btc, sol, doge`);
      } else {
        const sign = data.usd_24h_change >= 0 ? "+" : "";
        await send(`${intent.token.toUpperCase()}: $${data.usd.toLocaleString()} (${sign}${data.usd_24h_change.toFixed(2)}% 24h)`);
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
        await send(`Bot balance:\nUSDC: ${usdc}\nETH: ${Number(formatUnits(eth, 18)).toFixed(6)}`);
      } catch {
        await send("Could not fetch balance.");
      }
      break;
    }

    case "analysis": {
      const nonce = randomUUID();
      pendingX402.set(nonce, { type: "analysis", token: intent.token, send });
      const payUrl = `${BOT_URL}/api/analyze/${intent.token}?nonce=${nonce}`;
      await send(
        `Analysis of ${intent.token.toUpperCase()} costs $${PRICE_PER_ANALYSIS} USDC.\nPay via x402:\n${payUrl}\nResult will be sent here after payment.`
      );
      break;
    }

    case "swap": {
      if (intent.amount < MIN_SWAP_USDC) {
        await send(`Minimum swap is ${MIN_SWAP_USDC} USDC.`);
        break;
      }
      const totalCost = Math.round((intent.amount + SWAP_FEE_USDC) * 1e6) / 1e6;
      const nonce = randomUUID();
      pendingX402.set(nonce, { type: "swap", amount: intent.amount, send });
      const payUrl = `${BOT_URL}/api/swap/${intent.amount}?nonce=${nonce}`;
      await send(
        `Swap ${intent.amount} USDC → ETH (fee: $${SWAP_FEE_USDC})\nTotal: ${totalCost} USDC\nPay via x402:\n${payUrl}\nETH will be sent to your wallet after payment.`
      );
      break;
    }

    default:
      await send('Type "help" to see available commands.');
  }
}

// ── XMTP stream ───────────────────────────────────────────────────────────────

async function startXmtp(): Promise<void> {
  const signer = {
    type: "EOA" as const,
    getIdentifier: () => ({
      identifier: account.address,
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage: async (message: string): Promise<Uint8Array> => {
      const sig = await account.signMessage({ message });
      return toBytes(sig);
    },
  };

  const encryptionKey = toBytes(
    keccak256(toBytes(process.env.BOT_PRIVATE_KEY as `0x${string}`))
  );

  const client = await Client.create(signer, {
    dbEncryptionKey: encryptionKey,
    env: "production",
  });

  try {
    await client.revokeAllOtherInstallations();
    console.log("[xmtp] revoked stale installations");
  } catch (e) {
    console.warn("[xmtp] could not revoke installations:", e);
  }

  await client.conversations.sync();
  console.log(`[xmtp] listening — inboxId: ${client.inboxId}`);

  while (true) {
    try {
      const stream = await client.conversations.streamAllMessages();
      for await (const message of stream) {
        if (!message) continue;
        if (message.senderInboxId === client.inboxId) continue;
        if (message.contentType?.typeId !== "text") continue;

        const content = typeof message.content === "string" ? message.content.trim() : "";
        if (!content) continue;

        const convId = message.conversationId;
        const send = async (text: string): Promise<void> => {
          try {
            const conv = await client.conversations.getConversationById(convId);
            if (conv) await conv.send(text);
          } catch (e) {
            console.error("[xmtp] send error:", e);
          }
        };

        handleMessage({ senderInboxId: message.senderInboxId, content, conversationId: convId, send })
          .catch((e) => console.error("[handler] error:", e));
      }
    } catch (err) {
      console.error("[xmtp] stream error, restarting in 5s:", err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

startXmtp().catch((e) => { console.error("[xmtp] fatal:", e); process.exit(1); });
