import { createWalletClient, createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { Attribution } from "ox/erc8021";

export const account = privateKeyToAccount(
  process.env.BOT_PRIVATE_KEY as `0x${string}`
);

// ERC-8021: proper dataSuffix with the 8021 repeating marker (not raw UTF-8 bytes)
const builderCode = process.env.BUILDER_CODE ?? "bc_jnu0cmfe";
const dataSuffix = Attribution.toDataSuffix({ codes: [builderCode] });
console.log(`[wallet] builder code: ${builderCode} dataSuffix: ${dataSuffix}`);

export const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(process.env.BASE_RPC_URL),
  dataSuffix,
});

export const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL),
});
