import { encodeFunctionData, concat, parseUnits, maxUint256, type Abi } from "viem";
import { walletClient, publicClient } from "./wallet.js";
import { UNISWAP_ROUTER, USDC_ADDRESS, WETH_ADDRESS, UNISWAP_POOL_FEE } from "./constants/contracts.js";
import { BUILDER_CODE, BUILDER_CODE_RAW } from "./constants/builderCode.js";
import { logTransaction } from "./transactions.js";

const ERC20_ABI: Abi = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
];

const EXACT_INPUT_SINGLE_ABI: Abi = [{
  name: "exactInputSingle",
  type: "function",
  stateMutability: "payable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "recipient", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "amountOutMinimum", type: "uint256" },
    { name: "sqrtPriceLimitX96", type: "uint160" },
  ]}],
  outputs: [{ name: "amountOut", type: "uint256" }],
}];

export async function executeSwap(
  amountUSDC: number,
  recipientAddress: `0x${string}`
): Promise<`0x${string}`> {
  const amountIn = parseUnits(amountUSDC.toString(), 6);
  const botAddress = walletClient.account!.address;

  // Only approve if current allowance is insufficient — approve maxUint256 so we never re-approve
  const currentAllowance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [botAddress, UNISWAP_ROUTER],
  }) as bigint;

  console.log(`[swap] current allowance: ${currentAllowance} needed: ${amountIn}`);

  if (currentAllowance < amountIn) {
    console.log(`[swap] approving maxUint256 USDC to router`);
    const approveTx = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [UNISWAP_ROUTER, maxUint256],
    });
    console.log(`[swap] approve tx: ${approveTx}`);
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
    if (approveReceipt.status !== "success") throw new Error("USDC approve transaction reverted");
    // Wait for RPC state to propagate (load-balanced nodes can lag 1-2 blocks)
    await new Promise((r) => setTimeout(r, 3000));
    console.log(`[swap] approve confirmed`);
  } else {
    console.log(`[swap] allowance sufficient, skipping approve`);
  }

  const swapParams = {
    tokenIn: USDC_ADDRESS,
    tokenOut: WETH_ADDRESS,
    fee: UNISWAP_POOL_FEE,
    recipient: recipientAddress,
    amountIn,
    amountOutMinimum: 0n,
    sqrtPriceLimitX96: 0n,
  };

  // Simulate first to surface errors before spending gas
  console.log(`[swap] simulating exactInputSingle...`);
  const simulation = await publicClient.simulateContract({
    address: UNISWAP_ROUTER,
    abi: EXACT_INPUT_SINGLE_ABI,
    functionName: "exactInputSingle",
    args: [swapParams],
    account: botAddress,
  });
  console.log(`[swap] simulation ok, expected amountOut: ${simulation.result}`);

  const calldata = encodeFunctionData({
    abi: EXACT_INPUT_SINGLE_ABI,
    functionName: "exactInputSingle",
    args: [swapParams],
  });

  // ERC-8021: append Builder Code to calldata for Base attribution
  const calldataWithSuffix = BUILDER_CODE ? concat([calldata, BUILDER_CODE]) : calldata;

  console.log(`[swap] builder:${BUILDER_CODE_RAW} sending swap`);
  const txHash = await walletClient.sendTransaction({
    to: UNISWAP_ROUTER,
    data: calldataWithSuffix,
  });

  console.log(`[swap] tx sent: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`Swap transaction reverted (tx: ${txHash})`);
  console.log(`[swap] confirmed: ${txHash}`);

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

  return txHash;
}
