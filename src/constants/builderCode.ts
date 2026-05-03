// Register before first deploy:
// curl -X POST https://api.base.dev/v1/agents/builder-codes \
//   -H "Content-Type: application/json" \
//   -d '{"walletAddress": "0xBOT_ADDRESS"}'
// Save returned bc_xxxx as BUILDER_CODE env var in Render
export const BUILDER_CODE = (process.env.BUILDER_CODE ?? "") as `0x${string}`;
