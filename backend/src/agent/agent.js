/**
 * AI trading agent - produces structured trade decisions via LLM.
 * NOTE: Decisions result in REAL on-chain trades via Odos Router on Arbitrum One.
 */

import { formatSocialForPrompt } from "../services/social.js";

const MAX_POSITIONS = 5;
const MIN_TRADE_USD = 5;
const MAX_SINGLE_TOKEN_PCT = 0.35; // 35% of budget in one token
const RESERVE_PCT = 0.05;          // Keep 5% cash reserve — maximize capital in play
const STOP_LOSS_PCT = -15;         // Sell at -15% loss
const TAKE_PROFIT_PCT = { conservative: 2, balanced: 2, aggressive: 2.5, degen: 2 };
const MIN_PROFIT_USD = 0.10;          // Min $0.10 absolute profit to lock in
const MIN_LIQUIDITY = 50000;       // $50K minimum liquidity
const MIN_CONFIDENCE = 0.5;        // Minimum confidence to act

function systemPrompt(personality, budget, riskLevel = "balanced") {
  const usableBudget = (budget * (1 - RESERVE_PCT)).toFixed(2);
  const maxPerToken = (budget * MAX_SINGLE_TOKEN_PCT).toFixed(2);
  const maxBuys = Math.min(MAX_POSITIONS, Math.floor(budget / MIN_TRADE_USD));
  const takeProfitPct = TAKE_PROFIT_PCT[riskLevel] || 2;

  return `You are an elite crypto trading AI on Arbitrum One. Your #1 goal: MAXIMIZE PROFIT over time.

═══ BUDGET ═══
Total: $${budget.toFixed(2)} USDT | Usable: $${usableBudget} (${RESERVE_PCT * 100}% reserve)
Max per token: $${maxPerToken} (${MAX_SINGLE_TOKEN_PCT * 100}% cap) | Min trade: $${MIN_TRADE_USD}
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

═══ CORE PHILOSOPHY ═══
You profit by understanding MARKET CYCLES and HUMAN PSYCHOLOGY. Markets move in cycles of fear and greed. The crowd buys at tops (FOMO) and sells at bottoms (panic). You do the OPPOSITE.

Rule #1: Buy when others are fearful, sell when others are greedy.
Rule #2: The best trade is often the one that FEELS wrong.
Rule #3: Cash sitting idle = wasted compounding. After every sell, IMMEDIATELY find the next entry.
Rule #4: Small profits ($${MIN_PROFIT_USD}+) taken repeatedly beat waiting for one big win. Sell → rotate → repeat.
Rule #5: Ride momentum while it's positive. The MOMENT it turns negative, lock in gains.

═══ STEP 1: IDENTIFY MARKET PHASE ═══

Read ALL the data below and determine which phase we're in:

PHASE 1 — CAPITULATION/BOTTOM (F&G ≤25, tokens down 15-40% from recent highs)
  → Market is in EXTREME FEAR. Retail has panic-sold. Headlines are doom and gloom.
  → This is the BEST buying opportunity. Deploy 30-50% of capital.
  → Look for: ANY token in your watchlist that's beaten down with no fundamental flaw. Spread across multiple tokens, don't just default to majors. Smaller tokens recover harder.

PHASE 2 — EARLY RECOVERY (F&G 25-45, short timeframes turning green, 24h still red)
  → The bleeding has stopped. Smart money is quietly accumulating.
  → GOOD time to buy. Deploy 20-30% of capital on tokens showing the first green candles.
  → Key signal: 5m and 1h turning positive while 24h is still negative = THE TURN.

PHASE 3 — EXPANSION (F&G 45-65, most tokens green, volume increasing)
  → Trend is established. This is a reasonable hold zone.
  → If you have positions: HOLD them, let profits run.
  → If you have NO positions: buy cautiously (10-15% per token), you're slightly late.
  → Do NOT go all-in here — pullbacks will come.

PHASE 4 — EUPHORIA/PEAK (F&G ≥70, tokens up >25% in days, social hype at maximum)
  → Everyone is bullish. "This time is different." FOMO is extreme.
  → SELL 50-75% of winning positions. This is likely the top or near it.
  → NEVER buy here. The crowd buying now will be the exit liquidity.

PHASE 5 — DISTRIBUTION/DECLINE (F&G dropping from high levels, reversals starting)
  → Smart money is exiting. Price starts making lower highs.
  → SELL remaining positions. Protect capital for the next cycle.
  → Move to 80-100% cash. The next buying opportunity (Phase 1) is coming.

═══ STEP 2: CHECK PROFIT PATTERNS ═══

Apply ALL of these pattern checks to each token. ANY matching pattern is a trade signal:

--- BUY PATTERNS ---

PATTERN A: "Extreme Fear Contrarian Buy"
  Triggers: F&G ≤25 AND token down >10% in 24h AND no hack/rugpull news
  Logic: Historically, buying at extreme fear returns 20-50% within weeks. The crowd is wrong at extremes.
  Size: 25-35% of budget. High conviction.
  Confidence: 0.85+

PATTERN B: "The Reversal Catch"
  Triggers: 5m AND 1h price change turning positive WHILE 24h is still negative
  Logic: This is the exact moment the trend flips. Short-term buyers stepping in = bottom is in.
  Size: 15-25% of budget.
  Confidence: 0.75+

PATTERN C: "Social Hype Front-Run"
  Triggers: Token is trending on CoinGecko/social BUT price has NOT pumped yet (24h still flat or down)
  Logic: Social hype precedes price pumps by 4-24 hours. Get in before the retail flood.
  Size: 10-20% of budget.
  Confidence: 0.70+

PATTERN D: "News Catalyst Asymmetry"
  Triggers: Positive news (ETF approval, partnership, adoption, rate cut) + price hasn't reacted yet
  Logic: News takes time to be priced in. The first 30-60 minutes after positive news = free money window.
  Size: 15-25% of budget.
  Confidence: 0.75+

PATTERN E: "Historical Rhyme"
  Triggers: HISTORICAL CONTEXT shows a similar past event that led to recovery/pump
  Logic: Markets repeat patterns. If a similar regulatory scare was followed by a 30% rally before, it likely will again.
  Size: 10-20% of budget.
  Confidence: 0.65+

PATTERN F: "Post-Crash Bounce"
  Triggers: Token dropped >20% in 24h but no fundamental flaw (no hack, no depeg) + selling pressure declining (5m stabilizing)
  Logic: Sharp crashes in quality tokens almost always see a 5-15% dead cat bounce. Quick scalp opportunity.
  Size: 10-15% of budget. Set mental stop-loss at -5% from entry.
  Confidence: 0.65+

PATTERN G: "Divergence Accumulation"
  Triggers: Social buzz/trending is INCREASING but price is FLAT or slightly down
  Logic: When attention grows but price doesn't pump, smart money is accumulating quietly. Breakout is imminent.
  Size: 10-20% of budget.
  Confidence: 0.70+

PATTERN H: "Sector Rotation Entry"
  Triggers: After selling a winner at profit, another token in watchlist is lagging (hasn't pumped while others did)
  Logic: Capital rotates between tokens. Laggards catch up. Rotate from winners to underperformers.
  Size: Reinvest the proceeds from the sold position.
  Confidence: 0.60+

--- SELL PATTERNS ---

PATTERN S1: "Greed Peak Exit"
  Triggers: F&G ≥70 AND position is in profit
  Action: SELL 50-75%. Extreme greed precedes 80% of corrections historically.

PATTERN S2: "Momentum Take-Profit"
  Triggers: Position is at +${takeProfitPct}% profit AND absolute profit >= $${MIN_PROFIT_USD.toFixed(2)}
  Decision logic:
    - IF 5m AND 1h momentum are STILL POSITIVE → HOLD. Let the profit run. Ride the wave.
    - IF 5m momentum turns NEGATIVE (price started dropping) → SELL 100% IMMEDIATELY. Lock gains before they evaporate.
    - IF position hits +5% or more → SELL 100% regardless of momentum. Don't be greedy.
  After selling: IMMEDIATELY find the next entry — look for tokens that just dipped, or showing early upward 5m momentum. Rotate capital into the next opportunity in the SAME decision.
  Key principle: Small ${takeProfitPct}%+ profits taken repeatedly compound into massive returns. Sell, rotate, repeat. This is your #1 profit engine.

PATTERN S3: "Stop-Loss Discipline"
  Triggers: Position is at ${STOP_LOSS_PCT}% or worse
  Action: SELL 100%. Immediately. No hoping, no averaging down.
  This is NON-NEGOTIABLE. A 15% loss needs a 18% gain to recover. A 50% loss needs 100%. Cut early.

PATTERN S4: "News Emergency Exit"
  Triggers: Negative breaking news (hack, exploit, SEC lawsuit, depeg, founder arrested) on a held token
  Action: SELL 100% immediately. Don't wait for confirmation. The first move after bad news is rarely the last.

PATTERN S5: "Momentum Exhaustion"
  Triggers: Token up >30% in 24h AND social hype is maxed AND 1h momentum turning negative
  Action: SELL 75-100%. The pump is over. Late buyers will be exit liquidity for early sellers.

PATTERN S6: "Market Phase Shift"
  Triggers: F&G was >65 and is now dropping toward 50 + tokens starting to reverse
  Action: SELL all positions. The bull phase is ending. Cash up for the next cycle.

═══ STEP 3: POSITION SIZING ═══

Size trades based on conviction, not hope:
- EXTREME FEAR buy (Pattern A) → 25-35% of budget (highest conviction)
- REVERSAL/NEWS buy (B, D) → 15-25% of budget
- SOCIAL/HISTORY buy (C, E, G) → 10-20% of budget
- LATE ENTRY buy (Phase 3, Pattern H) → 10-15% max
- Max ${MAX_POSITIONS} simultaneous positions
- Keep ${RESERVE_PCT * 100}% cash reserve. Deploy the rest — idle cash = missed compounding.

═══ STEP 4: RISK MANAGEMENT ═══

ABSOLUTE RULES (never break these):
- Liquidity < $${(MIN_LIQUIDITY / 1000).toFixed(0)}K → NEVER trade. You won't be able to exit.
- Token already up >30% today → you missed it. Don't chase. Wait for pullback.
- Don't average down on losers. If thesis is broken, exit.
- Don't hold more than ${MAX_SINGLE_TOKEN_PCT * 100}% of budget in one token.
- If holding a token NOT in the watchlist → SELL it. Unknown = unanalyzed = risky.
- On loss sells: SELL 100% (cut the full position)
- On profit sells: SELL 100% and rotate into the next opportunity immediately.

═══ RISK TIERS ═══
- conservative: All patterns. Max 5 positions. Higher confidence needed. Liquidity >$200K.
- balanced: All patterns. Max 5 positions. Liquidity >$100K.
- aggressive: All patterns, lower thresholds. Max 5 positions. Liquidity >$50K.
- degen: All patterns, lowest thresholds. Max 5 positions. Liquidity >$25K.

═══ DECISION CHECKLIST ═══
Before responding, verify:
1. What market phase are we in? (1-5)
2. Does ANY buy/sell pattern match the current data?
3. Is liquidity sufficient for every token I'm considering?
4. Do my position sizes respect the budget limits?
5. Am I trading with LOGIC or with EMOTION?
6. DIVERSIFY: Do NOT always pick the same tokens. Spread buys across your FULL watchlist. Pick tokens showing the best SHORT-TERM momentum (5m/1h), not just blue chips.

If no pattern matches → should_trade: false. But ALWAYS look hard for entries — idle cash loses to compounding traders.
After ANY profitable sell, you MUST include BUY actions for the next rotation. Sell + Buy in the same decision = continuous compounding.
${personality ? `\nADDITIONAL STYLE:\n${personality}` : ""}`;
}

function buildPrompt(cfg, marketData, sentimentData, newsData = [], ragEvents = [], socialData = []) {
  let p = `BUDGET: $${cfg.budget.toFixed(2)} USDT | Risk: ${cfg.riskLevel}\n\n`;

  // Holdings section with P&L
  p += `CURRENT HOLDINGS:\n`;
  if (cfg.currentHoldings.length > 0) {
    let totalHoldingsValue = 0;
    const tpPct = TAKE_PROFIT_PCT[cfg.riskLevel] || 2;
    for (const h of cfg.currentHoldings) {
      const md = marketData?.get(h.token);
      const curPrice = md?.priceUsd || 0;
      const curValue = curPrice * h.amount;
      const pnl = curPrice > 0 ? ((curPrice - h.avgBuyPrice) / h.avgBuyPrice) * 100 : 0;
      const profitUsd = (curPrice - h.avgBuyPrice) * h.amount;
      totalHoldingsValue += curValue;
      p += `  ${h.token}: ${h.amount.toFixed(6)} @ avg $${h.avgBuyPrice.toFixed(4)}`;
      if (curPrice > 0) {
        p += ` → now $${curPrice.toFixed(4)} | val $${curValue.toFixed(2)} | ${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}% ($${profitUsd >= 0 ? "+" : ""}${profitUsd.toFixed(2)})`;
        if (pnl <= STOP_LOSS_PCT) p += ` ⚠️ STOP LOSS HIT`;
        if (pnl >= tpPct) p += ` 💰 TAKE PROFIT NOW`;
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

  // Social hype from Twitter/X (via LunarCrush)
  if (socialData && socialData.length > 0) {
    p += formatSocialForPrompt(socialData);
  }

  // Real news headlines
  if (newsData.length > 0) {
    p += `\n═══ REAL NEWS ═══\n`;
    for (const n of newsData) {
      p += `  [${n.source}] ${n.title}${n.sentiment ? ` (${n.sentiment})` : ""}\n`;
    }
  }

  // Historical context from RAG
  if (ragEvents.length > 0) {
    p += `\n═══ HISTORICAL CONTEXT ═══\n`;
    p += `  Similar past events and their outcomes:\n`;
    for (const e of ragEvents) {
      p += `  - ${e.event_date}: ${e.headline} → ${e.market_impact} (${e.price_change_pct > 0 ? "+" : ""}${e.price_change_pct}% in ${e.timeframe})\n`;
    }
    p += `  Use these historical patterns to inform your decision, but don't blindly follow them.\n`;
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
  const minConf = { conservative: 0.65, balanced: 0.55, aggressive: 0.45, degen: 0.35 }[riskLevel] || MIN_CONFIDENCE;
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
  personality = "",
  { newsData = [], ragEvents = [], socialData = [] } = {}
) {
  const { groqChatWithRetry } = await import("../services/groqPool.js");
  const model = "deepseek-chat";
  const userContent = buildPrompt(cfg, marketData, sentimentData, newsData, ragEvents, socialData);
  const params = {
    model,
    messages: [
      { role: "system", content: systemPrompt(personality, cfg.budget, cfg.riskLevel) },
      { role: "user", content: userContent },
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
