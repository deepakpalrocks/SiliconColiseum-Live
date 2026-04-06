// USDT on Arbitrum One
export const USDT_CONTRACT_ADDRESS =
  process.env.USDT_CONTRACT_ADDRESS || "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";

// Arbitrum One RPC
export const RPC_URL =
  process.env.RPC_URL || "https://arb1.arbitrum.io/rpc";

// ERC20 ABI for basic token reads
export const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];
