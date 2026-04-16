/**
 * AI trading agent - produces structured trade decisions via LLM.
 * NOTE: Decisions result in REAL on-chain trades via Odos Router on Arbitrum One.
 */

const MAX_POSITIONS = 5;
const MIN_TRADE_USD = 5;
const MAX_SINGLE_TOKEN_PCT = 0.35; // 35% of budget in one token
const RESERVE_PCT = 0.15;          // Keep 15% cash reserve
const STOP_LOSS_PCT = -15;         // Sell at -15% loss
const TAKE_PROFIT_PCT = 40;        // Start taking profit at +40%
const MIN_LIQUIDITY = 50000;       // $50K minimum liquidity
const MIN_CONFIDENCE = 0.5;        // Minimum confidence to act

function systemPrompt(personality, budget) {
  const usableBudget = (budget * (1 - RESERVE_PCT)).toFixed(2);
  const maxPerToken = (budget * MAX_SINGLE_TOKEN_PCT).toFixed(2);
  const maxBuys = Math.min(MAX_POSITIONS, Math.floor(budget / MIN_TRADE_USD));

  return `You are a PROFITABLE crypto trading AI on Arbitrum One. Your #1 goal is MAKING MONEY.

═══ BUDGET ═══
Total: $${budget.toFixed(2)} USDT
Usable (after ${RESERVE_PCT * 100}% reserve): $${usableBudget}
Max per token: $${maxPerToken} (${MAX_SINGLE_TOKEN_PCT * 100}% cap)
Min trade size: $${MIN_TRADE_USD}
Max BUY actions: ${maxBuys}

═══ RESPONSE FORMAT ═══
Valid JSON only:
{
  "should_trade": boolean,
  "reasoning": "1-2 sentence analysis",
  "market_analysis": "brief market conditions",
  "actions": [
    {
      "action": "BUY" or "SELL",
      "token": "SYMBOL",
      "amount_usd": number (>= ${MIN_TRADE_USD}, sum of all buys <= ${usableBudget}),
      "confidence": 0.0-1.0,
      "urgency": "low"|"medium"|"high",
      "reason": "specific reason"
    }
  ]
}

═══ PROFIT STRATEGY (FOLLOW STRICTLY) ═══

BUY SIGNALS (need 2+ for entry):
✅ 5m AND 1h both green + volume rising → momentum entry
✅ 24h down >10% but 5m/1h turning green → reversal play
✅ High social buzz (>6/10) + positive sentiment + price NOT already pumped
✅ Strong liquidity (>$200K) + consistent uptrend across timeframes
✅ Token down from recent high but fundamentals unchanged → dip buy

SELL SIGNALS (any 1 is enough):
🔴 Holding at ${STOP_LOSS_PCT}% or worse → STOP LOSS, sell immediately
🔴 Holding at +${TAKE_PROFIT_PCT}%+ → take profit on 50-75% of position
🔴 5m AND 1h both red + volume spike → momentum reversal, exit
🔴 Negative sentiment shift + price dropping → exit before worse
🔴 Pumped >60% in 24h + momentum fading → sell the peak

AVOID (DO NOT BUY):
🚫 Liquidity < $${(MIN_LIQUIDITY / 1000).toFixed(0)}K → too thin, will get slipped
🚫 Already pumped >40% in 24h with no pullback → late entry trap
🚫 Negative or neutral sentiment + no price momentum
🚫 Token you already hold at a loss (don't average down on losers)
🚫 More than ${MAX_POSITIONS} positions total

═══ EDGE CASES ═══
- If ALL tokens are red → should_trade: false, preserve capital
- If budget < $${MIN_TRADE_USD * 2} → should_trade: false (too small to trade effectively)
- If you hold a token not in watchlist → SELL it (can't monitor = can't manage)
- If a token's 5m change is >+20% → likely a spike, wait for pullback
- If sentiment is "positive" but price is already up >30% in 24h → priced in, skip
- If you hold >3 positions already → only sell, don't add new buys
- SELL decisions don't count against budget (they free up capital)
- When selling at a loss, sell 100% to cut losses clean
- When taking profit, sell 50-75% and let rest ride

═══ RISK TIERS ═══
- conservative: Only confidence >0.8, max 2 buys, liquidity >$500K
- balanced: Confidence >0.65, max 3 buys, liquidity >$200K
- aggressive: Confidence >0.5, max 4 buys, liquidity >$100K
- degen: Confidence >0.4, max 5 buys, liquidity >$50K

REMEMBER: It's better to NOT trade than to make a bad trade. Cash is a position.
${personality ? `\nADDITIONAL STYLE:\n${personality}` : ""}`;
}

function buildPrompt(cfg, marketData, sentimentData) {
  let p = `BUDGET: $${cfg.budget.toFixed(2)} USDT | Risk: ${cfg.riskLevel}\n\n`;

  // Holdings section with P&L
  p += `CURRENT HOLDINGS:\n`;
  if (cfg.currentHoldings.length > 0) {
    let totalHoldingsValue = 0;
    for (const h of cfg.currentHoldings) {
      const md = marketData?.get(h.token);
      const curPrice = md?.priceUsd || 0;
      const curValue = curPrice * h.amount;
      const pnl = curPrice > 0 ? ((curPrice - h.avgBuyPrice) / h.avgBuyPrice) * 100 : 0;
      totalHoldingsValue += curValue;
      p += `  ${h.token}: ${h.amount.toFixed(6)} @ avg $${h.avgBuyPrice.toFixed(4)}`;
      if (curPrice > 0) {
        p += ` → now $${curPrice.toFixed(4)} | val $${curValue.toFixed(2)} | ${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%`;
        if (pnl <= STOP_LOSS_PCT) p += ` ⚠️ STOP LOSS HIT`;
        if (pnl >= TAKE_PROFIT_PCT) p += ` 💰 TAKE PROFIT`;
      }
      p += `\n`;
    }
    p += `  Total holdings value: $${totalHoldingsValue.toFixed(2)}\n`;
    p += `  Open positions: ${cfg.currentHoldings.length}/${MAX_POSITIONS}\n`;
  } else {
    p += `  None (100% cash) — look for entry opportunities\n`;
  }

  // Market data
  p += `\nMARKET DATA:\n`;
  if (marketData && marketData.size > 0) {
    for (const [sym, d] of marketData) {
      const liq = d.liquidity || 0;
      const liqWarning = liq < MIN_LIQUIDITY ? " ⚠️LOW_LIQ" : "";
      const momentum = (d.priceChange5m > 0 && d.priceChange1h > 0) ? " 📈" :
                       (d.priceChange5m < 0 && d.priceChange1h < 0) ? " 📉" : "";
      p += `  ${sym}: $${d.priceUsd} | 5m:${fmt(d.priceChange5m)}% 1h:${fmt(d.priceChange1h)}% 24h:${fmt(d.priceChange24h)}% | vol:${fmtN(d.volume24h)} liq:${fmtN(liq)}${liqWarning}${momentum}\n`;
    }
  } else {
    p += `  No data available — DO NOT TRADE.\n`;
  }

  // Sentiment
  p += `\nSENTIMENT:\n`;
  if (sentimentData && sentimentData.length > 0) {
    for (const s of sentimentData) {
      p += `  ${s.token}: ${s.sentiment} (score:${s.sentimentScore}, buzz:${s.buzzLevel}/10) ${s.summary}\n`;
    }
  } else {
    p += `  No sentiment data available.\n`;
  }

  p += `\nACTION REQUIRED: Analyze the above data. Should you trade or hold? Your budget is $${cfg.budget.toFixed(2)}. Every BUY must be >= $${MIN_TRADE_USD}. Total buys must be <= $${(cfg.budget * (1 - RESERVE_PCT)).toFixed(2)}. Respond with JSON only.`;
  return p;
}

function fmt(n) {
  if (n === undefined || n === null) return "0";
  return (n >= 0 ? "+" : "") + Number(n).toFixed(2);
}

function fmtN(n) {
  if (!n) return "$0";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}

/**
 * Post-process AI decision to enforce ALL budget and safety rules.
 * The AI (especially 8B models) regularly ignores constraints — this catches everything.
 */
function sanitizeDecision(decision, budget, cfg = {}) {
  if (!decision || typeof decision !== "object") {
    return { should_trade: false, reasoning: "Invalid AI response", actions: [] };
  }

  // Ensure required fields exist
  if (!decision.reasoning) decision.reasoning = "";
  if (!decision.market_analysis) decision.market_analysis = "";
  if (!Array.isArray(decision.actions)) decision.actions = [];

  // If AI says don't trade, respect it
  if (!decision.should_trade || !decision.actions.length) {
    decision.should_trade = false;
    decision.actions = [];
    return decision;
  }

  // Budget too small to trade
  if (budget < MIN_TRADE_USD) {
    decision.should_trade = false;
    decision.reasoning += " (Budget too small to trade)";
    decision.actions = [];
    return decision;
  }

  const usableBudget = budget * (1 - RESERVE_PCT);

  // Separate and validate actions
  let buys = [];
  let sells = [];

  for (const action of decision.actions) {
    // Normalize action type
    const type = String(action.action || "").toUpperCase().trim();
    if (type !== "BUY" && type !== "SELL") continue;

    // Ensure required fields
    if (!action.token || typeof action.token !== "string") continue;
    action.token = action.token.toUpperCase().trim();
    action.amount_usd = Math.abs(Number(action.amount_usd) || 0);
    action.confidence = Math.max(0, Math.min(1, Number(action.confidence) || 0.5));
    action.action = type;

    if (type === "BUY") buys.push(action);
    else sells.push(action);
  }

  // --- SELL validation ---
  // Remove duplicate sells (keep highest amount)
  const sellMap = new Map();
  for (const s of sells) {
    const existing = sellMap.get(s.token);
    if (!existing || s.amount_usd > existing.amount_usd) {
      sellMap.set(s.token, s);
    }
  }
  sells = [...sellMap.values()];

  // Only sell tokens we actually hold
  if (cfg.currentHoldings) {
    sells = sells.filter((s) => cfg.currentHoldings.some((h) => h.token === s.token));
  }

  // --- BUY validation ---
  // Remove duplicate buys (keep highest confidence)
  const buyMap = new Map();
  for (const b of buys) {
    const existing = buyMap.get(b.token);
    if (!existing || b.confidence > existing.confidence) {
      buyMap.set(b.token, b);
    }
  }
  buys = [...buyMap.values()];

  // Don't buy tokens we're also selling
  const sellTokens = new Set(sells.map((s) => s.token));
  buys = buys.filter((b) => !sellTokens.has(b.token));

  // Filter by minimum confidence
  const riskLevel = cfg.riskLevel || "balanced";
  const minConf = { conservative: 0.8, balanced: 0.65, aggressive: 0.5, degen: 0.4 }[riskLevel] || MIN_CONFIDENCE;
  buys = buys.filter((b) => b.confidence >= minConf);

  // Sort by confidence (highest first) and limit count
  buys.sort((a, b) => b.confidence - a.confidence);
  const maxBuys = Math.min(MAX_POSITIONS, Math.floor(budget / MIN_TRADE_USD));
  buys = buys.slice(0, maxBuys);

  // Cap individual buys at max single token percentage
  const maxPerToken = budget * MAX_SINGLE_TOKEN_PCT;
  for (const b of buys) {
    if (b.amount_usd > maxPerToken) b.amount_usd = maxPerToken;
  }

  // Scale down if total exceeds usable budget
  if (buys.length > 0) {
    let totalRequested = buys.reduce((sum, a) => sum + a.amount_usd, 0);

    if (totalRequested > usableBudget) {
      const scale = (usableBudget * 0.98) / totalRequested; // 2% buffer
      for (const a of buys) {
        a.amount_usd = Math.round(a.amount_usd * scale * 100) / 100;
      }
    }

    // Remove buys below minimum trade size
    buys = buys.filter((a) => a.amount_usd >= MIN_TRADE_USD);

    // Round amounts to 2 decimal places
    for (const b of buys) {
      b.amount_usd = Math.round(b.amount_usd * 100) / 100;
    }
  }

  // Reassemble
  decision.actions = [...sells, ...buys];

  // If no valid actions remain
  if (!decision.actions.length) {
    decision.should_trade = false;
    decision.reasoning += " (No valid trades after safety checks)";
  }

  return decision;
}

export async function runTradeAgent(
  client,
  cfg,
  marketData = new Map(),
  sentimentData = [],
  personality = ""
) {
  const { groqChatWithRetry } = await import("../services/groqPool.js");
  const model = process.env.TRADE_MODEL || "llama-3.3-70b";
  const params = {
    model,
    messages: [
      { role: "system", content: systemPrompt(personality, cfg.budget) },
      { role: "user", content: buildPrompt(cfg, marketData, sentimentData) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  };
  const response = await groqChatWithRetry(params);

  const choice = response.choices[0];
  if (!choice) throw new Error("No response from LLM");

  const raw = choice.message.content;
  let decision;
  try {
    decision = JSON.parse(raw);
  } catch (err) {
    // Try to extract JSON from response if it's wrapped in text
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        decision = JSON.parse(jsonMatch[0]);
      } catch {
        throw new Error(`Failed to parse trade decision: ${err.message}\nRaw: ${raw.slice(0, 500)}`);
      }
    } else {
      throw new Error(`Failed to parse trade decision: ${err.message}\nRaw: ${raw.slice(0, 500)}`);
    }
  }

  // Post-process to enforce all rules
  return sanitizeDecision(decision, cfg.budget, cfg);
}
