/**
 * Crypto sentiment analysis via DeepSeek LLM + real news from CryptoPanic.
 */

import { groqChatWithRetry } from "./groqPool.js";
import { fetchCryptoNews } from "./news.js";

export async function fetchTwitterSentiment(client, tokens) {
  try {
    const model = "deepseek-chat";

    // Fetch real news headlines for grounding
    let newsContext = "";
    try {
      const news = await fetchCryptoNews(tokens);
      if (news.length > 0) {
        newsContext = "\n\nREAL RECENT NEWS HEADLINES:\n" + news.map((n) => `- [${n.source}] ${n.title} (sentiment: ${n.sentiment || "unknown"})`).join("\n");
      }
    } catch {
      // News fetch failed — continue without it
    }

    const response = await groqChatWithRetry({
      model,
      messages: [
        {
          role: "system",
          content: `You are a crypto sentiment analyst. Analyze sentiment based on the REAL news headlines provided. Do NOT fabricate or hallucinate any news. If no news is provided for a token, return neutral sentiment. Respond with JSON: { "sentiments": [{ "token": "SYM", "sentimentScore": -1 to 1, "sentiment": "bearish"|"neutral"|"bullish", "buzzLevel": 0-10, "keyThemes": [], "summary": "short" }] }`,
        },
        {
          role: "user",
          content: `Analyze sentiment for: ${tokens.join(", ")}${newsContext}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from LLM");

    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed)
      ? parsed
      : parsed.sentiments || parsed.tokens || parsed.data || [parsed];
    return arr;
  } catch (err) {
    console.warn(`  [!] Sentiment analysis failed: ${err.message}`);
    return tokens.map((token) => ({
      token,
      sentimentScore: 0,
      sentiment: "neutral",
      buzzLevel: 0,
      keyThemes: [],
      summary: "Sentiment data unavailable",
    }));
  }
}
