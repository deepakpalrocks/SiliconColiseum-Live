// USDT on Arbitrum One
export const USDT_CONTRACT_ADDRESS = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";

// Arbitrum One chain config
export const ARBITRUM_CHAIN_ID = 42161;
export const ARBITRUM_CHAIN_ID_HEX = "0xa4b1";
export const ARBITRUM_CHAIN_CONFIG = {
  chainId: "0xa4b1",
  chainName: "Arbitrum One",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://arb1.arbitrum.io/rpc"],
  blockExplorerUrls: ["https://arbiscan.io"],
};

// USDT ABI - for deposits
export const USDT_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];
