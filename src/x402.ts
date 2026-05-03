import { parseSignature, type Abi } from "viem";
import { walletClient, publicClient } from "./wallet.js";
import { USDC_ADDRESS } from "./constants/contracts.js";
import { logTransaction } from "./transactions.js";

const TRANSFER_WITH_AUTH_ABI: Abi = [{
  name: "transferWithAuthorization",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { name: "from",        type: "address" },
    { name: "to",          type: "address" },
    { name: "value",       type: "uint256" },
    { name: "validAfter",  type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce",       type: "bytes32" },
    { name: "v",           type: "uint8"   },
    { name: "r",           type: "bytes32" },
    { name: "s",           type: "bytes32" },
  ],
  outputs: [],
}];

export type SettledPayment = {
  userAddress: `0x${string}`;
  amountUSDC: number;
  txHash: `0x${string}`;
};

/** Build the base64 value for the X-PAYMENT-REQUIRED header */
export function build402Header(amountUSDC: number, botAddress: string, description: string): string {
  return Buffer.from(JSON.stringify({
    x402Version: "1",
    requirements: [{
      scheme: "exact",
      network: "eip155:8453",
      amount: String(Math.round(amountUSDC * 1e6)),
      token: USDC_ADDRESS,
      payTo: botAddress,
      description,
    }],
  })).toString("base64");
}

/** Verify and settle an x402 X-PAYMENT header using EIP-3009 transferWithAuthorization */
export async function settleX402Payment(xPaymentHeader: string): Promise<SettledPayment> {
  const payment = JSON.parse(Buffer.from(xPaymentHeader, "base64").toString("utf8"));

  if (payment.scheme !== "exact") throw new Error(`Unsupported scheme: ${payment.scheme}`);
  if (!["eip155:8453", "base-mainnet"].includes(payment.network)) {
    throw new Error(`Wrong network: ${payment.network}`);
  }

  const { authorization, signature } = payment.payload;
  const botAddress = (process.env.BOT_ADDRESS as string).toLowerCase();

  if (authorization.to.toLowerCase() !== botAddress) {
    throw new Error(`Payment to wrong address: ${authorization.to}`);
  }

  const now = Math.floor(Date.now() / 1000);
  if (now < Number(authorization.validAfter))  throw new Error("Authorization not yet valid");
  if (now > Number(authorization.validBefore)) throw new Error("Authorization expired");

  const { v, r, s } = parseSignature(signature as `0x${string}`);
  const amountUSDC = Number(authorization.value) / 1e6;

  console.log(`[x402] settling ${amountUSDC} USDC from ${authorization.from}`);

  const txHash = await walletClient.writeContract({
    address: USDC_ADDRESS,
    abi: TRANSFER_WITH_AUTH_ABI,
    functionName: "transferWithAuthorization",
    args: [
      authorization.from as `0x${string}`,
      authorization.to as `0x${string}`,
      BigInt(authorization.value),
      BigInt(authorization.validAfter),
      BigInt(authorization.validBefore),
      authorization.nonce as `0x${string}`,
      Number(v),
      r as `0x${string}`,
      s as `0x${string}`,
    ],
  });

  console.log(`[x402] payment settled tx=${txHash}`);
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  logTransaction({
    type: "payment_received",
    txHash,
    amountIn: amountUSDC,
    tokenIn: "USDC",
    from: authorization.from,
    timestamp: Date.now(),
    status: "confirmed",
  });

  return { userAddress: authorization.from as `0x${string}`, amountUSDC, txHash };
}
