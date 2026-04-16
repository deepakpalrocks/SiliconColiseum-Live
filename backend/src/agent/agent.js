/**
 * AI trading agent - produces structured trade decisions via Groq LLM.
 * NOTE: Decisions result in REAL on-chain trades via Odos Router on Arbitrum One.
 */

function systemPrompt(personality) {
  let base = `You are an expert crypto trading advisor AI managing REAL funds on Arbitrum One. Your trade decisions will be executed as REAL swaps via Odos Router. You analyze market data, sentiment, and portfolio state to make trading decisions.

CRITICAL: These are REAL trades with REAL money. Be extra cautious with position sizing and risk management.

You MUST respond with valid JSON matching this exact schema:
{
  "should_trade": boolean,
  "reasoning": "string explaining your overall analysis",
  "market_analysis": "brief analysis of current market conditions",
  "actions": [
    {
      "action": "BUY" or "SELL",
      "token": "TOKEN_SYMBOL",
      "amount_usd": number (USD value to trade),
      "confidence": number (0.0 to 1.0),
      "urgency": "low" | "medium" | "high",
      "reason": "string explaining this specific action"
    }
  ]
}

TRADING STRATEGIES:

1. TREND DETECTION
   - 5m AND 1h both positive + rising volume -> potential early rally, consider buying
   - Pumped >50% in 24h and 1h momentum slowing -> possible top, consider selling
   - Price down significantly but sentiment turning positive -> potential reversal

2. SENTIMENT-DRIVEN
   - High buzz (7+) + positive sentiment + early price rise -> strong buy signal
   - Declining buzz + price still rising -> distribution phase, be cautious
   - Negative sentiment + price dropping -> avoid or sell

3. LIQUIDITY AWARENESS (CRITICAL for real trades)
   - If trade amount > 1% of pool liquidity -> reduce position to minimize slippage
   - Liquidity < $50K -> avoid entirely (too risky for real execution)
   - Liquidity < $100K -> tiny positions only ($10-50 max)
   - Higher liquidity = more confidence in execution quality

4. SLIPPAGE AWARENESS
   - Odos Router optimizes routes but slippage still occurs
   - For large trades, prefer splitting into smaller amounts
   - Avoid low-liquidity pairs where slippage could be >2%

5. RISK MANAGEMENT (REAL MONEY)
   - Max 20% of budget in single token (unless degen)
   - Holding at > -15% loss -> consider cutting losses
   - Holding at > +30% profit -> consider partial profit-taking
   - Keep at least 20% reserve for dip-buying opportunities
   - Never go all-in on a single trade

RISK LEVEL BEHAVIOR:
- conservative: High-confidence only (>0.8), 5-10% positions, only top liquidity tokens
- balanced: Medium+ confidence (>0.6), 10-20% positions
- aggressive: Lower confidence ok (>0.4), 15-30% positions
- degen: Any positive signal, up to 40%+ positions

RULES:
- Total BUY amounts MUST NOT exceed available budget
- Can only SELL tokens present in current holdings
- If no good opportunities -> should_trade: false, empty actions
- Always ground reasoning in actual data provided
- Prefer fewer, higher-conviction trades over many small ones
- Consider gas costs (~$0.01-0.05 per trade on Arbitrum)`;

  if (personality) {
    base += `\n\nADDITIONAL PERSONALITY/INSTRUCTIONS:\n${personality}`;
  }

  return base;
}

function buildPrompt(cfg, marketData, sentimentData) {
  let p = `=== LIVE TRADING SESSION (REAL MONEY) ===\n\n`;
  p += `Budget: $${cfg.budget.toFixed(2)} USDT\n`;
  p += `Risk Level: ${cfg.riskLevel}\n`;
  p += `Chain: Arbitrum One | Router: Odos\n`;
  p += `Tokens: ${cfg.selectedTokens.join(", ")}\n\n`;

  p += `=== CURRENT HOLDINGS ===\n`;
  if (cfg.currentHoldings.length > 0) {
    for (const h of cfg.currentHoldings) {
      const md = marketData?.get(h.token);
      const curPrice = md?.priceUsd || 0;
      const curValue = curPrice * h.amount;
      const pnl =
        curPrice > 0
          ? ((curPrice - h.avgBuyPrice) / h.avgBuyPrice) * 100
          : 0;
      p += `${h.token}: ${h.amount.toLocaleString()} units @ avg $${h.avgBuyPrice}\n`;
      if (curPrice > 0) {
        p += `  Current price: $${curPrice} | Value: $${curValue.toFixed(2)} | P&L: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%\n`;
      }
    }
  } else {
    p += `None (fresh start with USDT only)\n`;
  }

  p += `\n=== LIVE MARKET DATA ===\n`;
  if (marketData && marketData.size > 0) {
    for (const [sym, d] of marketData) {
      p += `\n${sym} (${d.name}):\n`;
      p += `  Price: $${d.priceUsd}\n`;
      p += `  5min: ${fmt(d.priceChange5m)}% | 1h: ${fmt(d.priceChange1h)}% | 6h: ${fmt(d.priceChange6h)}% | 24h: ${fmt(d.priceChange24h)}%\n`;
      p += `  24h Volume: ${fmtN(d.volume24h)} | Liquidity: ${fmtN(d.liquidity)}`;
      if (d.marketCap) p += ` | MCap: ${fmtN(d.marketCap)}`;
      p += `\n`;
    }
  } else {
    p += `No market data available - DO NOT TRADE without data.\n`;
  }

  p += `\n=== TWITTER/X SENTIMENT ===\n`;
  if (sentimentData && sentimentData.length > 0) {
    for (const s of sentimentData) {
      p += `${s.token}: ${s.sentiment} (score: ${s.sentimentScore}, buzz: ${s.buzzLevel}/10)\n`;
      if (s.keyThemes?.length) p += `  Themes: ${s.keyThemes.join(", ")}\n`;
      p += `  ${s.summary}\n`;
    }
  } else {
    p += `No sentiment data available.\n`;
  }

  p += `\nAnalyze ALL data above and provide your trading decision as JSON. Remember: these are REAL trades with REAL money.`;
  return p;
}

function fmt(n) {
  return (n >= 0 ? "+" : "") + n;
}

function fmtN(n) {
  if (!n) return "$0";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(2) + "K";
  return "$" + n.toFixed(2);
}

export async function runTradeAgent(
  client,
  cfg,
  marketData = new Map(),
  sentimentData = [],
  personality = ""
) {
  // Import retry wrapper - falls back to direct client if not available
  const { groqChatWithRetry } = await import("../services/groqPool.js");
  const model = process.env.TRADE_MODEL || "llama3.1-8b";
  const params = {
    model,
    messages: [
      { role: "system", content: systemPrompt(personality) },
      { role: "user", content: buildPrompt(cfg, marketData, sentimentData) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.5, // Lower temp for more consistent real-money decisions
  };
  const response = await groqChatWithRetry(params);

  const choice = response.choices[0];
  if (!choice) throw new Error("No response from LLM");

  const raw = choice.message.content;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse trade decision: ${err.message}\nRaw: ${raw}`
    );
  }
}
