import { toHex } from "viem";

const BC_RAW = process.env.BUILDER_CODE ?? "bc_jnu0cmfe";

function toBuilderHex(code: string): `0x${string}` {
  if (!code) return "0x";
  if (code.startsWith("0x")) return code as `0x${string}`;
  // ERC-8021: encode builder code string as UTF-8 bytes → hex suffix
  return toHex(new TextEncoder().encode(code));
}

export const BUILDER_CODE = toBuilderHex(BC_RAW);
export const BUILDER_CODE_RAW = BC_RAW;
