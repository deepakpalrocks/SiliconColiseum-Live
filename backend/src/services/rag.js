/**
 * RAG (Retrieval-Augmented Generation) — historical event retrieval.
 * Uses simple keyword matching in SQLite (no vector DB needed at this scale).
 */

import { queryAll } from "../db/database.js";

/**
 * Find relevant historical events for given tokens and optional news headlines.
 * Returns top 5 most relevant past events with their outcomes.
 *
 * @param {string[]} tokens - Token symbols the agent is watching
 * @param {Array<{title: string}>} newsHeadlines - Optional recent headlines for keyword matching
 * @returns {Array<{headline: string, event_date: string, event_type: string, market_impact: string, price_change_pct: number, timeframe: string, description: string}>}
 */
export function findRelevantEvents(tokens = [], newsHeadlines = []) {
  if (!tokens.length) return [];

  // Build keyword set from tokens + news headlines
  const keywords = new Set(tokens.map((t) => t.toUpperCase()));

  // Extract additional keywords from news headlines
  const eventKeywords = [
    "etf", "sec", "hack", "exploit", "regulation", "ban", "approval",
    "partnership", "upgrade", "halving", "merge", "fork", "lawsuit",
    "fed", "rate", "inflation", "crash", "rally", "whale", "airdrop",
    "stablecoin", "depeg", "bankruptcy", "listing", "delist",
  ];

  for (const item of newsHeadlines) {
    const lower = (item.title || "").toLowerCase();
    for (const kw of eventKeywords) {
      if (lower.includes(kw)) keywords.add(kw.toUpperCase());
    }
  }

  // Query events matching any of the tokens
  const tokenPlaceholders = tokens.map(() => "?").join(",");
  const tokenConditions = tokens.map((t) => `tokens LIKE '%${t.replace(/'/g, "''")}%'`).join(" OR ");

  let events = [];
  try {
    events = queryAll(
      `SELECT * FROM historical_events
       WHERE ${tokenConditions}
       ORDER BY event_date DESC
       LIMIT 10`
    );
  } catch {
    // Table might not exist yet
    return [];
  }

  // If we got fewer than 5 results, also fetch general market events
  if (events.length < 5) {
    try {
      const general = queryAll(
        `SELECT * FROM historical_events
         WHERE event_type IN ('macro', 'regulatory')
         ORDER BY event_date DESC
         LIMIT ?`,
        [5 - events.length]
      );
      const existingIds = new Set(events.map((e) => e.id));
      for (const g of general) {
        if (!existingIds.has(g.id)) events.push(g);
      }
    } catch {
      // ignore
    }
  }

  // Score and sort by relevance
  events.sort((a, b) => {
    let scoreA = 0, scoreB = 0;
    for (const t of tokens) {
      if ((a.tokens || "").toUpperCase().includes(t)) scoreA += 3;
      if ((b.tokens || "").toUpperCase().includes(t)) scoreB += 3;
    }
    // Recency bonus
    scoreA += a.event_date > b.event_date ? 1 : 0;
    scoreB += b.event_date > a.event_date ? 1 : 0;
    return scoreB - scoreA;
  });

  return events.slice(0, 5).map((e) => ({
    headline: e.headline,
    event_date: e.event_date,
    event_type: e.event_type,
    market_impact: e.market_impact,
    price_change_pct: e.price_change_pct,
    timeframe: e.timeframe,
    description: e.description,
  }));
}
