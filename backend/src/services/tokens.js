/**
 * GMX v2 supported perpetual markets on Arbitrum One.
 * Each market maps a token symbol to its GMX market contract address.
 * All markets use USDC as the short (collateral) token.
 *
 * NOTE: Market addresses are for GMX v2 on Arbitrum One.
 * Verify against https://app.gmx.io if any market fails.
 */

export const GMX_MARKETS = [
  // ═══ Major Markets (native Arbitrum tokens) ═══
  {
    symbol: "WETH",
    name: "Ethereum",
    marketAddress: "0x70d95587d40A2caf56bd97485aB3Eec10Bee6336",
    indexToken: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    decimals: 18,
    category: "major",
  },
  {
    symbol: "WBTC",
    name: "Bitcoin",
    marketAddress: "0x47c031236e19d024b42f8AE6780E44A573170703",
    indexToken: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    decimals: 8,
    category: "major",
  },
  {
    symbol: "ARB",
    name: "Arbitrum",
    marketAddress: "0xC25cEf6061Cf5dE5eb761b50E4743c1F5D7E5407",
    indexToken: "0x912CE59144191C1204E64559FE8253a0e49E6548",
    decimals: 18,
    category: "major",
  },

  // ═══ DeFi Blue Chip (native on Arbitrum) ═══
  {
    symbol: "LINK",
    name: "Chainlink",
    marketAddress: "0x7f1fa204bb700853D36994DA19F830b6Ad18455C",
    indexToken: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
    decimals: 18,
    category: "defi",
  },
  {
    symbol: "UNI",
    name: "Uniswap",
    marketAddress: "0xc7Abb2C5f3BF3CEB389dF0Eecd6120D451170B50",
    indexToken: "0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0",
    decimals: 18,
    category: "defi",
  },
  {
    symbol: "AAVE",
    name: "Aave",
    marketAddress: "0x1CbBa6346F110c8A5ea739ef2d1eb182990e4EB2",
    indexToken: "0xba5DdD1f9d7F570dc94a51479a000E3BCE967196",
    decimals: 18,
    category: "defi",
  },
  {
    symbol: "GMX",
    name: "GMX",
    marketAddress: "0x55391D178Ce46e7AC8eaAEa50A72D1A5a8A622Da",
    indexToken: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a",
    decimals: 18,
    category: "defi",
  },

  // ═══ Synthetic Markets (priced by GMX oracle, no native Arbitrum token) ═══
  {
    symbol: "SOL",
    name: "Solana",
    marketAddress: "0x09400D9DB990D5ed3f35D7be61DfAEB900Af03C9",
    indexToken: null,
    decimals: 9,
    category: "synthetic",
    synthetic: true,
  },
  {
    symbol: "DOGE",
    name: "Dogecoin",
    marketAddress: "0x6853EA96FF216fAb11D2d930CE3C508556A4bdc4",
    indexToken: null,
    decimals: 8,
    category: "meme",
    synthetic: true,
  },
  {
    symbol: "PEPE",
    name: "Pepe",
    marketAddress: "0x2b477989A149B17073D9C9C82eC9cB03591e20c6",
    indexToken: null,
    decimals: 18,
    category: "meme",
    synthetic: true,
  },
  {
    symbol: "XRP",
    name: "XRP",
    marketAddress: "0x0CCB4fAa6f1F1B30911619f1184082aB4E25813c",
    indexToken: null,
    decimals: 6,
    category: "synthetic",
    synthetic: true,
  },
  {
    symbol: "NEAR",
    name: "NEAR Protocol",
    marketAddress: "0x63Dc80EE90F26363B3FCD609007CC9e14c8991BE",
    indexToken: null,
    decimals: 24,
    category: "synthetic",
    synthetic: true,
  },
  {
    symbol: "ATOM",
    name: "Cosmos",
    marketAddress: "0x248C35760068cE009a13076D573ed3497A47bCD4",
    indexToken: null,
    decimals: 6,
    category: "synthetic",
    synthetic: true,
  },
];

// USDT on Arbitrum One — base currency for deposits/withdrawals
export const USDT_ADDRESS = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";
export const USDT_DECIMALS = 6;

// ═══ Lookup Helpers ═══

export const MARKET_MAP = new Map(GMX_MARKETS.map(m => [m.symbol, m]));

/** Get GMX market info by token symbol */
export function getGmxMarket(symbol) {
  return MARKET_MAP.get(symbol) || null;
}

/** Get index token address (null for synthetics) */
export function getTokenAddress(symbol) {
  return MARKET_MAP.get(symbol)?.indexToken || null;
}

/** Get token decimals */
export function getTokenDecimals(symbol) {
  return MARKET_MAP.get(symbol)?.decimals || 18;
}

/** All tradeable markets */
export function getTradeableTokens() {
  return GMX_MARKETS;
}

// Backward-compatible alias for routes/tokens.js
export const ARBITRUM_TOKENS = GMX_MARKETS;

/** Categories for frontend display */
export const TOKEN_CATEGORIES = {
  major: "Major",
  defi: "DeFi",
  synthetic: "Synthetic (Cross-chain)",
  meme: "Meme",
};
