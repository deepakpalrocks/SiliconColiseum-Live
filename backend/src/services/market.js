/**
 * Market data service - fetches live price, volume, liquidity from DexScreener.
 * Optimized for Arbitrum One tokens.
 */

import { getTokenAddress } from "./tokens.js";

const DEXSCREENER_SEARCH = "https://api.dexscreener.com/latest/dex/search";
const DEXSCREENER_TOKEN = "https://api.dexscreener.com/latest/dex/tokens";

export async function fetchTokenMarketData(symbol) {
  try {
    // Try by contract address first for more accurate results on Arbitrum
    const address = getTokenAddress(symbol);
    let data;

    if (address) {
      const res = await fetch(`${DEXSCREENER_TOKEN}/${address}`);
      if (res.ok) {
        data = await res.json();
      }
    }

    // Fallback to search by symbol
    if (!data?.pairs?.length) {
      const res = await fetch(
        `${DEXSCREENER_SEARCH}?q=${encodeURIComponent(symbol)}`
      );
      if (!res.ok) throw new Error(`DexScreener ${res.status}`);
      data = await res.json();
    }

    if (!data.pairs?.length) return null;

    // Prefer Arbitrum One pairs, then sort by liquidity
    const pair = data.pairs
      .filter(
        (p) =>
          p.baseToken.symbol.toUpperCase() === symbol.toUpperCase() ||
          (address && p.baseToken.address.toLowerCase() === address.toLowerCase())
      )
      .sort((a, b) => {
        // Prefer arbitrum chain
        const aIsArb = a.chainId === "arbitrum" ? 1 : 0;
        const bIsArb = b.chainId === "arbitrum" ? 1 : 0;
        if (aIsArb !== bIsArb) return bIsArb - aIsArb;
        return (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0);
      })[0];

    if (!pair) return null;

    return {
      symbol: pair.baseToken.symbol,
      name: pair.baseToken.name,
      priceUsd: parseFloat(pair.priceUsd) || 0,
      priceChange5m: pair.priceChange?.m5 || 0,
      priceChange1h: pair.priceChange?.h1 || 0,
      priceChange6h: pair.priceChange?.h6 || 0,
      priceChange24h: pair.priceChange?.h24 || 0,
      volume24h: pair.volume?.h24 || 0,
      liquidity: pair.liquidity?.usd || 0,
      marketCap: pair.marketCap || 0,
      dexId: pair.dexId,
      pairAddress: pair.pairAddress,
      chainId: pair.chainId,
    };
  } catch (err) {
    console.warn(`  [!] Market data for ${symbol}: ${err.message}`);
    return null;
  }
}

export async function fetchMultipleTokens(symbols) {
  const results = new Map();
  // Process in batches of 5 to avoid rate limiting
  const batchSize = 5;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const promises = batch.map(async (sym) => {
      const data = await fetchTokenMarketData(sym);
      if (data) results.set(sym.toUpperCase(), data);
    });
    await Promise.all(promises);
    // Small delay between batches
    if (i + batchSize < symbols.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return results;
}
