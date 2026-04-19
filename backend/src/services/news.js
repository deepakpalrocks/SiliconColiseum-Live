/**
 * CoinGecko News API integration.
 * Free, no API key required.
 * https://www.coingecko.com/api/documentation
 */

const API_BASE = "https://api.coingecko.com/api/v3/news";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cache = { data: [], ts: 0, tokens: "" };

/**
 * Fetch recent crypto news from CoinGecko API.
 * @param {string[]} tokens - Token symbols to filter (e.g. ["BTC", "ETH"])
 * @returns {Array<{title: string, source: string, sentiment: string|null, url: string, publishedAt: string}>}
 */
export async function fetchCryptoNews(tokens = []) {
  const tokenKey = tokens.sort().join(",");

  // Return cached data if fresh
  if (cache.tokens === tokenKey && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.data;
  }

  try {
    const res = await fetch(`${API_BASE}?page=1`, {
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[NEWS] CoinGecko API returned ${res.status}`);
      return [];
    }

    const data = await res.json();
    const articles = (data.data || []).slice(0, 20);

    // Filter to articles mentioning any of our tokens
    const tokenSet = new Set(tokens.map((t) => t.toUpperCase()));
    const filtered = articles.filter((item) => {
      if (tokenSet.size === 0) return true;
      const text = (item.title + " " + (item.description || "")).toUpperCase();
      return [...tokenSet].some((t) => text.includes(t));
    });

    // If no token-specific news, return top general crypto news
    const relevant = filtered.length > 0 ? filtered : articles.slice(0, 10);

    const results = relevant.slice(0, 15).map((item) => ({
      title: item.title,
      source: item.author || "CoinGecko",
      sentiment: deriveSentiment(item),
      url: item.url,
      publishedAt: item.updated_at
        ? new Date(item.updated_at * 1000).toISOString()
        : null,
    }));

    // Update cache
    cache = { data: results, ts: Date.now(), tokens: tokenKey };

    return results;
  } catch (err) {
    console.warn(`[NEWS] Failed to fetch news: ${err.message}`);
    return [];
  }
}

/**
 * Derive sentiment from article title keywords (simple heuristic).
 */
function deriveSentiment(article) {
  const text = ((article.title || "") + " " + (article.description || "")).toLowerCase();

  const bullish = ["surge", "rally", "soar", "jump", "gain", "bull", "record",
    "high", "boost", "approval", "approve", "adopt", "launch", "partner",
    "upgrade", "breakout", "milestone", "positive", "growth", "inflow"];
  const bearish = ["crash", "drop", "plunge", "fall", "dump", "bear", "low",
    "hack", "exploit", "ban", "sue", "lawsuit", "fraud", "scam", "fear",
    "risk", "sell", "decline", "outflow", "collapse", "bankrupt"];

  let score = 0;
  for (const w of bullish) if (text.includes(w)) score++;
  for (const w of bearish) if (text.includes(w)) score--;

  if (score >= 2) return "positive";
  if (score <= -2) return "negative";
  return "neutral";
}
