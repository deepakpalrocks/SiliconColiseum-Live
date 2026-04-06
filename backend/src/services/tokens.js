/**
 * Arbitrum One token registry with contract addresses.
 * All tokens must have verified liquidity on Arbitrum One DEXes.
 */

export const ARBITRUM_TOKENS = [
  // === Major / Blue Chip ===
  { symbol: "WETH", name: "Wrapped Ether", address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18, category: "major" },
  { symbol: "WBTC", name: "Wrapped Bitcoin", address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8, category: "major" },
  { symbol: "ARB", name: "Arbitrum", address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18, category: "major" },
  { symbol: "USDC", name: "USD Coin", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, category: "stable" },
  { symbol: "USDC.e", name: "Bridged USDC", address: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", decimals: 6, category: "stable" },
  { symbol: "DAI", name: "Dai Stablecoin", address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18, category: "stable" },

  // === DeFi Blue Chip ===
  { symbol: "LINK", name: "Chainlink", address: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", decimals: 18, category: "defi" },
  { symbol: "UNI", name: "Uniswap", address: "0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0", decimals: 18, category: "defi" },
  { symbol: "AAVE", name: "Aave", address: "0xba5DdD1f9d7F570dc94a51479a000E3BCE967196", decimals: 18, category: "defi" },
  { symbol: "CRV", name: "Curve DAO", address: "0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978", decimals: 18, category: "defi" },
  { symbol: "LDO", name: "Lido DAO", address: "0x13Ad51ed4F1B7e9Dc168d8a00cB3f4dDD85EfA60", decimals: 18, category: "defi" },
  { symbol: "SUSHI", name: "SushiSwap", address: "0xd4d42F0b6DEF4CE0383636770eF773390d85c61A", decimals: 18, category: "defi" },

  // === Arbitrum Native DeFi ===
  { symbol: "GMX", name: "GMX", address: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a", decimals: 18, category: "arb-defi" },
  { symbol: "PENDLE", name: "Pendle", address: "0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8", decimals: 18, category: "arb-defi" },
  { symbol: "RDNT", name: "Radiant Capital", address: "0x3082CC23568eA640225c2467653dB90e9250AaA0", decimals: 18, category: "arb-defi" },
  { symbol: "MAGIC", name: "Magic", address: "0x539bdE0d7Dbd336b79148AA742883198BBF60342", decimals: 18, category: "arb-defi" },
  { symbol: "GNS", name: "Gains Network", address: "0x18c11FD286C5EC11c3b683Caa813B77f5163A122", decimals: 18, category: "arb-defi" },
  { symbol: "GRAIL", name: "Camelot", address: "0x3d9907F9a368ad0a51Be60f7Da3b97cf940982D8", decimals: 18, category: "arb-defi" },
  { symbol: "JOE", name: "Trader Joe", address: "0x371c7ec6D8039ff7933a2AA28EB827Ffe1F52f07", decimals: 18, category: "arb-defi" },
  { symbol: "VELA", name: "Vela Exchange", address: "0x088cd8f5eF3652623c22D48b1605DCfE860Cd704", decimals: 18, category: "arb-defi" },
  { symbol: "DPX", name: "Dopex", address: "0x6C2C06790b3E3E3c38e12Ee22F8183b37a13EE55", decimals: 18, category: "arb-defi" },
  { symbol: "LODE", name: "Lodestar Finance", address: "0xF19547f9ED24aA66b03c3a552D181Ae334FBb8DB", decimals: 18, category: "arb-defi" },
  { symbol: "Y2K", name: "Y2K Finance", address: "0x65c936f008BC34fE819bce9Fa5afD9dc2d49977f", decimals: 18, category: "arb-defi" },

  // === Gaming / Metaverse ===
  { symbol: "IMX", name: "Immutable X", address: "0x9c67eE39e3C4954396b9142010653F17257dd39C", decimals: 18, category: "gaming" },
  { symbol: "PRIME", name: "Echelon Prime", address: "0x8E5E22042b4D2bFC078E67428F4b8Ef67b62f7E2", decimals: 18, category: "gaming" },

  // === Infrastructure / Layer 2 ===
  { symbol: "STG", name: "Stargate Finance", address: "0x6694340fc020c5E6B96567843da2df01b2CE1eb6", decimals: 18, category: "infra" },
  { symbol: "HOP", name: "Hop Protocol", address: "0xc5102fE9359FD9a28f877a67E36B0F050d81a3CC", decimals: 18, category: "infra" },
  { symbol: "BIFI", name: "Beefy Finance", address: "0x99C409E5f62E4bd2AC142f17caFb6810B8F0BAAE", decimals: 18, category: "infra" },

  // === Meme / Community ===
  { symbol: "PEPE", name: "Pepe", address: "0x25d887Ce7a35172C62FeBFD67a1856F20FaEbB00", decimals: 18, category: "meme" },
  { symbol: "SHIB", name: "Shiba Inu", address: "0x5033833c9fe8B9d3E09EEd2b73d28872f11B3c5e", decimals: 18, category: "meme" },
  { symbol: "DOGE", name: "Dogecoin", address: "0xC4da4c24fd591125c3F47b340b6f4f76111883d8", decimals: 8, category: "meme" },

  // === Liquid Staking / Yield ===
  { symbol: "wstETH", name: "Wrapped stETH", address: "0x5979D7b546E38E414F7E9822514be443A4800529", decimals: 18, category: "lsd" },
  { symbol: "rETH", name: "Rocket Pool ETH", address: "0xEC70Dcb4A1EFa46b8F2D97C310C9c4790ba5ffA", decimals: 18, category: "lsd" },
  { symbol: "frxETH", name: "Frax Ether", address: "0x178412e79c25968a32e89b11f63B33F733770c2A", decimals: 18, category: "lsd" },
  { symbol: "FRAX", name: "Frax", address: "0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F", decimals: 18, category: "stable" },

  // === Oracle / Data ===
  { symbol: "GRT", name: "The Graph", address: "0x9623063377AD1B27544C965cCd7342f7EA7e88C7", decimals: 18, category: "infra" },
  { symbol: "COMP", name: "Compound", address: "0x354A6dA3fcde098F8389cad84b0182725c6C91dE", decimals: 18, category: "defi" },
  { symbol: "BAL", name: "Balancer", address: "0x040d1EdC9569d4Bab2D15287Dc5A4F10F56a56B8", decimals: 18, category: "defi" },
  { symbol: "FXS", name: "Frax Share", address: "0x9d2F299715D94d8A7E6F5eaa8E654E8c74a988A7", decimals: 18, category: "defi" },
  { symbol: "RPL", name: "Rocket Pool", address: "0xB766039cc6DB368759C1E56B79AFfE831d0Cc507", decimals: 18, category: "defi" },
  { symbol: "KNC", name: "Kyber Network", address: "0xe4DDDfe67E7164b0FE14E218d80dC4C08eDC01cB", decimals: 18, category: "defi" },
  { symbol: "MCB", name: "MUX Protocol", address: "0x4e352cF164E64ADCBad318C3a1e222E9EBa4Ce42", decimals: 18, category: "arb-defi" },
  { symbol: "WINR", name: "WINR Protocol", address: "0xD77B108d4f6cefaa0Cae9506A934e825BEccA46E", decimals: 18, category: "arb-defi" },
  { symbol: "PREMIA", name: "Premia Finance", address: "0x51fC0f6660482Ea73330E414eFd7808811a57Fa2", decimals: 18, category: "arb-defi" },
  { symbol: "SPA", name: "Sperax", address: "0x5575552988A3A80504bBaeB1311674fCFd40aD4B", decimals: 18, category: "arb-defi" },
  { symbol: "JONES", name: "Jones DAO", address: "0x10393c20975cF177a3513071bC110f7962CD67da", decimals: 18, category: "arb-defi" },
  { symbol: "UMAMI", name: "Umami Finance", address: "0x1622bF67e6e5747b81866fE0b85178a93C7F86e3", decimals: 9, category: "arb-defi" },
  { symbol: "OATH", name: "Oath", address: "0xA1150db5105987CEC5Fd092273d1e3cbb22b378b", decimals: 18, category: "arb-defi" },
  { symbol: "MIM", name: "Magic Internet Money", address: "0xFEa7a6a0B346362BF88A9e4A88416B77a57D6c2A", decimals: 18, category: "stable" },
  { symbol: "LQTY", name: "Liquity", address: "0xfb9E5D956D889D91a82737B9bFCDaC1DCE3e1449", decimals: 18, category: "defi" },
];

// USDT on Arbitrum One (base trading currency)
export const USDT_ADDRESS = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";
export const USDT_DECIMALS = 6;

// Quick lookup map: symbol -> token info
export const TOKEN_MAP = new Map(ARBITRUM_TOKENS.map(t => [t.symbol, t]));

// Get address by symbol
export function getTokenAddress(symbol) {
  return TOKEN_MAP.get(symbol)?.address || null;
}

// Get decimals by symbol
export function getTokenDecimals(symbol) {
  return TOKEN_MAP.get(symbol)?.decimals || 18;
}

// Get all tradeable (non-stable) tokens
export function getTradeableTokens() {
  return ARBITRUM_TOKENS.filter(t => t.category !== "stable");
}

// Categories for frontend display
export const TOKEN_CATEGORIES = {
  major: "Major",
  defi: "DeFi Blue Chip",
  "arb-defi": "Arbitrum DeFi",
  gaming: "Gaming",
  infra: "Infrastructure",
  meme: "Meme",
  lsd: "Liquid Staking",
  stable: "Stablecoins",
};
