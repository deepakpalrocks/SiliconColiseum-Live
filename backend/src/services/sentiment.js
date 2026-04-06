/**
 * Crypto sentiment analysis via Groq (Llama 3.3 70B).
 */

import OpenAI from "openai";

export async function fetchTwitterSentiment(apiKey, tokens) {
  try {
    const client = new OpenAI({
      apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });

    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are a crypto sentiment analyst. Based on your knowledge of these tokens' communities, typical social media presence, and recent trends, provide a sentiment analysis.

Respond with valid JSON: { "sentiments": [ ... ] } where each item matches:
{
  "token": "SYMBOL",
  "sentimentScore": number (-1.0 very bearish to 1.0 very bullish),
  "sentiment": "very_bearish" | "bearish" | "neutral" | "bullish" | "very_bullish",
  "buzzLevel": number (0 to 10, estimated discussion level),
  "keyThemes": ["theme1", "theme2"],
  "summary": "1-2 sentence summary of general sentiment"
}`,
        },
        {
          role: "user",
          content: `Analyze sentiment for these crypto tokens: ${tokens.join(", ")}`,
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
