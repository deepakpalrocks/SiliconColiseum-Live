/**
 * Auto-learning cron: fetches recent crypto news and stores significant
 * events in the historical_events table for RAG memory.
 *
 * Runs periodically (e.g. every 6 hours) to grow the knowledge base
 * without manual intervention.
 */

import { queryOne, execute } from "../db/database.js";
import { fetchCryptoNews } from "../services/news.js";
import { groqChatWithRetry, getPoolSize } from "../services/groqPool.js";

// Tokens we care about tracking events for
const TRACKED_TOKENS = [
  "BTC", "ETH", "SOL", "ARB", "LINK", "UNI", "AAVE", "GMX",
  "OP", "AVAX", "MATIC", "BNB", "XRP", "DOGE", "ADA", "DOT",
];

/**
 * Fetch news, have LLM identify significant events, and store them.
 */
export async function learnFromNews() {
  if (!getPoolSize()) {
    console.log("[LEARNER] No LLM configured, skipping");
    return;
  }

  console.log("[LEARNER] Fetching news for event extraction...");

  let news;
  try {
    news = await fetchCryptoNews(TRACKED_TOKENS);
  } catch (err) {
    console.warn(`[LEARNER] News fetch failed: ${err.message}`);
    return;
  }

  if (!news.length) {
    console.log("[LEARNER] No news articles found");
    return;
  }

  // Check for duplicates — skip headlines we already stored
  const fresh = [];
  for (const item of news) {
    const existing = queryOne(
      "SELECT id FROM historical_events WHERE headline = ?",
      [item.title]
    );
    if (!existing) fresh.push(item);
  }

  if (!fresh.length) {
    console.log("[LEARNER] No new headlines to process");
    return;
  }

  console.log(`[LEARNER] Analyzing ${fresh.length} new headlines...`);

  // Ask LLM to identify significant market-moving events
  try {
    const response = await groqChatWithRetry({
      messages: [
        {
          role: "system",
          content: `You are a crypto market analyst. Given news headlines, identify ONLY significant market-moving events (regulatory changes, major hacks, protocol launches, macro shifts, partnerships). Skip routine price updates, minor news, and opinion pieces.

Respond with JSON: { "events": [ { "headline": "exact headline text", "tokens": ["BTC"], "event_type": "regulatory|hack|launch|partnership|macro", "market_impact": "very_bullish|bullish|neutral|bearish|very_bearish", "description": "1-2 sentence context", "price_change_pct": estimated % impact, "timeframe": "1h|24h|7d" } ] }

If no headlines are significant, return { "events": [] }. Be selective — only 1-3 events per batch at most.`,
        },
        {
          role: "user",
          content: `Analyze these headlines. Return ONLY significant market events:\n${fresh.map((n) => `- [${n.source}] ${n.title}`).join("\n")}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) return;

    const parsed = JSON.parse(content);
    const events = parsed.events || [];

    if (!events.length) {
      console.log("[LEARNER] No significant events identified");
      return;
    }

    let stored = 0;
    const today = new Date().toISOString().split("T")[0];

    for (const e of events) {
      if (!e.headline || !e.tokens?.length || !e.event_type || !e.market_impact) continue;

      // Double-check not already stored
      const dup = queryOne("SELECT id FROM historical_events WHERE headline = ?", [e.headline]);
      if (dup) continue;

      execute(
        `INSERT INTO historical_events (event_date, tokens, event_type, headline, description, market_impact, price_change_pct, timeframe, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'auto-learned')`,
        [
          today,
          JSON.stringify(e.tokens),
          e.event_type,
          e.headline,
          e.description || "",
          e.market_impact,
          e.price_change_pct || 0,
          e.timeframe || "24h",
        ]
      );
      stored++;
    }

    if (stored > 0) {
      console.log(`[LEARNER] Stored ${stored} new historical event(s)`);
    }
  } catch (err) {
    console.warn(`[LEARNER] Event extraction failed: ${err.message}`);
  }
}
