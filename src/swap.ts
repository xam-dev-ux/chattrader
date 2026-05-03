import { encodeFunctionData, concat, parseUnits, type Abi } from "viem";
import { walletClient } from "./wallet.js";
import { UNISWAP_ROUTER, USDC_ADDRESS, WETH_ADDRESS, UNISWAP_POOL_FEE } from "./constants/contracts.js";
import { BUILDER_CODE, BUILDER_CODE_RAW } from "./constants/builderCode.js";
import { logTransaction } from "./transactions.js";

const EXACT_INPUT_SINGLE_ABI: Abi = [
  {
    name: "exactInputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
];

export async function executeSwap(
  amountUSDC: number,
  recipientAddress: `0x${string}`
): Promise<`0x${string}`> {
  const calldata = encodeFunctionData({
    abi: EXACT_INPUT_SINGLE_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: USDC_ADDRESS,
        tokenOut: WETH_ADDRESS,
        fee: UNISWAP_POOL_FEE,
        recipient: recipientAddress,
        amountIn: parseUnits(amountUSDC.toString(), 6),
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  // ERC-8021: append Builder Code to calldata for Base attribution
  const calldataWithSuffix =
    BUILDER_CODE ? concat([calldata, BUILDER_CODE]) : calldata;

  const txHash = await walletClient.sendTransaction({
    to: UNISWAP_ROUTER,
    data: calldataWithSuffix,
  });

  logTransaction({
    type: "swap",
    txHash,
    amountIn: amountUSDC,
    tokenIn: "USDC",
    tokenOut: "ETH",
    timestamp: Date.now(),
    builderCode: BUILDER_CODE_RAW,
    status: "confirmed",
  });

  console.log(`[swap] builder:${BUILDER_CODE_RAW} tx:${txHash}`);
  return txHash;
}
