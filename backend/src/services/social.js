/**
 * Social hype & market sentiment — free APIs, no keys needed.
 *
 * Sources:
 *   1. CoinGecko Trending — top trending coins (search/social hype proxy)
 *   2. Fear & Greed Index — overall crypto market sentiment from social media, volume, volatility
 *   3. CoinGecko coin data — community/social stats per token
 */

const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

let trendingCache = { data: null, ts: 0 };
let fngCache = { data: null, ts: 0 };

/**
 * Fetch trending coins from CoinGecko (most searched/hyped).
 */
async function fetchTrending() {
  if (trendingCache.data && Date.now() - trendingCache.ts < CACHE_TTL_MS) {
    return trendingCache.data;
  }

  try {
    const res = await fetch("https://api.coingecko.com/api/v3/search/trending", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const json = await res.json();
    const coins = (json.coins || []).map((c) => ({
      symbol: (c.item?.symbol || "").toUpperCase(),
      name: c.item?.name || "",
      rank: (c.item?.score ?? 99) + 1, // score is 0-indexed
      marketCapRank: c.item?.market_cap_rank || 999,
      priceChange24h: c.item?.data?.price_change_percentage_24h?.usd ?? 0,
    }));

    trendingCache = { data: coins, ts: Date.now() };
    return coins;
  } catch (err) {
    console.warn(`[SOCIAL] Trending fetch failed: ${err.message}`);
    return [];
  }
}

/**
 * Fetch Fear & Greed Index (crypto market overall sentiment).
 */
async function fetchFearGreed() {
  if (fngCache.data && Date.now() - fngCache.ts < CACHE_TTL_MS) {
    return fngCache.data;
  }

  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=3", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const json = await res.json();
    const entries = json.data || [];
    if (!entries.length) return null;

    const result = {
      value: parseInt(entries[0].value),
      label: entries[0].value_classification,
      previous: entries[1] ? parseInt(entries[1].value) : null,
      trend: entries[1]
        ? parseInt(entries[0].value) > parseInt(entries[1].value) ? "improving" : "declining"
        : "stable",
    };

    fngCache = { data: result, ts: Date.now() };
    return result;
  } catch (err) {
    console.warn(`[SOCIAL] Fear & Greed fetch failed: ${err.message}`);
    return null;
  }
}

/**
 * Fetch social metrics for the given tokens.
 * Combines trending status + fear/greed for a social signal.
 *
 * @param {string[]} tokens - Token symbols
 * @returns {Array<{token: string, isTrending: boolean, trendingRank: number|null, hypeLevel: string}>}
 */
export async function fetchSocialMetrics(tokens = []) {
  const [trending, fng] = await Promise.all([fetchTrending(), fetchFearGreed()]);

  const trendingMap = new Map();
  for (const t of trending) {
    trendingMap.set(t.symbol, t);
  }

  const results = [];
  for (const sym of tokens) {
    const upper = sym.toUpperCase();
    const t = trendingMap.get(upper);

    results.push({
      token: upper,
      isTrending: !!t,
      trendingRank: t ? t.rank : null,
      hypeLevel: t
        ? (t.rank <= 3 ? "viral" : t.rank <= 7 ? "high" : "moderate")
        : "low",
      priceChange24h: t?.priceChange24h ?? null,
    });
  }

  // Attach fear & greed to all results
  if (fng) {
    for (const r of results) {
      r.fearGreed = fng.value;
      r.fearGreedLabel = fng.label;
      r.fearGreedTrend = fng.trend;
    }
  }

  return results;
}

/**
 * Format social metrics for injection into the AI agent prompt.
 */
export function formatSocialForPrompt(socialData) {
  if (!socialData || socialData.length === 0) return "";

  let out = "\n═══ SOCIAL HYPE (Twitter/X) ═══\n";

  // Fear & Greed (same for all tokens)
  const fng = socialData[0];
  if (fng?.fearGreed != null) {
    const emoji = fng.fearGreed >= 75 ? "Extreme Greed" :
                  fng.fearGreed >= 55 ? "Greed" :
                  fng.fearGreed >= 45 ? "Neutral" :
                  fng.fearGreed >= 25 ? "Fear" : "Extreme Fear";
    out += `  Market Sentiment: ${fng.fearGreed}/100 (${emoji}) — trend: ${fng.fearGreedTrend}\n`;
    if (fng.fearGreed <= 25) out += `  ⚠️ Extreme Fear = potential buying opportunity (historically)\n`;
    if (fng.fearGreed >= 75) out += `  ⚠️ Extreme Greed = potential top signal (historically)\n`;
  }

  // Trending tokens
  const trending = socialData.filter((s) => s.isTrending);
  if (trending.length > 0) {
    out += `  Trending on CoinGecko (high social search volume):\n`;
    for (const s of trending) {
      out += `    ${s.token}: #${s.trendingRank} trending (${s.hypeLevel} hype)`;
      if (s.priceChange24h != null) out += ` | 24h: ${s.priceChange24h >= 0 ? "+" : ""}${s.priceChange24h.toFixed(1)}%`;
      out += "\n";
    }
  }

  const notTrending = socialData.filter((s) => !s.isTrending);
  if (notTrending.length > 0) {
    out += `  Not trending: ${notTrending.map((s) => s.token).join(", ")} (low social hype)\n`;
  }

  out += `  Trending = high social volume/searches. Hype often precedes pumps but can also signal tops.\n`;
  return out;
}
