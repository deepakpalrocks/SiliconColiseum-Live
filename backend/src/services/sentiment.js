/**
 * Crypto sentiment analysis via Groq.
 * Accepts a pre-configured OpenAI-compatible client (from groqPool).
 */

export async function fetchTwitterSentiment(client, tokens) {
  try {
    const model = process.env.SENTIMENT_MODEL || "llama-3.1-8b-instant";

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `Crypto sentiment analyst. Respond with JSON: { "sentiments": [{ "token": "SYM", "sentimentScore": -1 to 1, "sentiment": "bearish"|"neutral"|"bullish", "buzzLevel": 0-10, "keyThemes": [], "summary": "short" }] }`,
        },
        {
          role: "user",
          content: `Sentiment for: ${tokens.join(", ")}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from Groq");

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
