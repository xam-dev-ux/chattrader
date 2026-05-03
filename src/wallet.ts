import { createWalletClient, createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

export const account = privateKeyToAccount(
  process.env.BOT_PRIVATE_KEY as `0x${string}`
);

export const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(process.env.BASE_RPC_URL),
});

export const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL),
});
