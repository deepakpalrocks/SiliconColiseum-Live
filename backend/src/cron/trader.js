/**
 * Cron job that evaluates trade decisions for all active agents
 * and executes REAL trades via Odos Router on Arbitrum One.
 * BUYs are bundled into a single transaction for gas efficiency.
 */

import { queryAll, queryOne, execute } from "../db/database.js";
import { runTradeAgent } from "../agent/agent.js";
import { fetchMultipleTokens } from "../services/market.js";
import { fetchTwitterSentiment } from "../services/sentiment.js";
import { executeBundledBuy, sellTokenForUSDT } from "../services/odos.js";
import { getWallet } from "../services/wallet.js";
import { getGroqClient, getPoolSize } from "../services/groqPool.js";
import { fetchCryptoNews } from "../services/news.js";
import { findRelevantEvents } from "../services/rag.js";
import { fetchSocialMetrics } from "../services/social.js";

// Lock to prevent concurrent evaluations
let isEvaluating = false;

export async function evaluateAllAgents() {
  if (isEvaluating) {
    console.log("[CRON] Evaluation already in progress, skipping");
    return;
  }

  isEvaluating = true;
  try {
    await _evaluateAllAgents();
  } finally {
    isEvaluating = false;
  }
}

async function _evaluateAllAgents() {
  if (!getPoolSize()) {
    console.warn("[CRON] No LLM provider configured, skipping evaluation");
    return;
  }

  let wallet = null;
  try {
    wallet = getWallet();
  } catch (err) {
    console.warn(`[CRON] Wallet not available: ${err.message} (paper trading still works)`);
  }

  const agents = queryAll("SELECT * FROM agents WHERE is_active = 1");
  if (!agents.length) {
    console.log("[CRON] No active agents to evaluate");
    return;
  }

  console.log(`[CRON] Evaluating ${agents.length} active agent(s)...`);

  // Collect all unique tokens
  const allTokens = new Set();
  for (const agent of agents) {
    const tokens = JSON.parse(agent.tokens);
    tokens.forEach((t) => allTokens.add(t));
  }

  console.log(`[CRON] Fetching market data for ${allTokens.size} tokens...`);
  const marketData = await fetchMultipleTokens([...allTokens]);

  for (const agent of agents) {
    try {
      const agentTokens = JSON.parse(agent.tokens);
      console.log(`[CRON] Fetching sentiment for "${agent.name}" (${agentTokens.length} tokens)...`);
      const sentimentClient = getGroqClient();
      const sentimentData = await fetchTwitterSentiment(sentimentClient, agentTokens);
      const tradeClient = getGroqClient();
      await evaluateAgent(tradeClient, agent, marketData, sentimentData);
      // 3-second delay between agents
      await new Promise((r) => setTimeout(r, 3000));
    } catch (err) {
      console.error(`[CRON] Error evaluating agent ${agent.name}: ${err.message}`);
    }
  }

  console.log("[CRON] Evaluation complete");
}

async function evaluateAgent(client, agent, allMarketData, sentimentData) {
  const tokens = JSON.parse(agent.tokens);
  const holdings = queryAll("SELECT * FROM holdings WHERE agent_id = ?", [agent.id]);

  const agentMarketData = new Map();
  for (const t of tokens) {
    if (allMarketData.has(t)) agentMarketData.set(t, allMarketData.get(t));
  }

  const currentHoldings = holdings.map((h) => ({
    token: h.token,
    amount: h.amount,
    avgBuyPrice: h.avg_buy_price,
  }));

  const cfg = {
    budget: agent.current_balance,
    riskLevel: agent.risk_level,
    selectedTokens: tokens,
    currentHoldings,
  };

  // Fetch real news, historical context, and social metrics
  let newsData = [];
  let ragEvents = [];
  let socialData = [];
  try {
    newsData = await fetchCryptoNews(tokens);
  } catch (err) {
    console.warn(`[CRON] News fetch failed for "${agent.name}": ${err.message}`);
  }
  try {
    ragEvents = findRelevantEvents(tokens, newsData);
  } catch (err) {
    console.warn(`[CRON] RAG lookup failed for "${agent.name}": ${err.message}`);
  }
  try {
    socialData = await fetchSocialMetrics(tokens);
  } catch (err) {
    console.warn(`[CRON] Social metrics failed for "${agent.name}": ${err.message}`);
  }

  console.log(`[CRON] Running AI for "${agent.name}" (balance: $${agent.current_balance.toFixed(2)}, news: ${newsData.length}, rag: ${ragEvents.length}, social: ${socialData.length})...`);

  const decision = await runTradeAgent(client, cfg, agentMarketData, sentimentData || [], agent.personality, { newsData, ragEvents, socialData });

  // Momentum-aware forced take-profit (safety net)
  const tpPctMap = { conservative: 2, balanced: 2, aggressive: 2.5, degen: 2 };
  const takeProfitPct = tpPctMap[agent.risk_level] || 2;
  const MIN_PROFIT_USD = 0.10;
  for (const h of holdings) {
    const md = agentMarketData.get(h.token);
    if (!md || !md.priceUsd || md.priceUsd <= 0) continue;
    const pnlPct = ((md.priceUsd - h.avg_buy_price) / h.avg_buy_price) * 100;
    const profitUsd = (md.priceUsd - h.avg_buy_price) * h.amount;
    if (pnlPct >= takeProfitPct && profitUsd >= MIN_PROFIT_USD) {
      const momentumNegative = (md.priceChange5m || 0) < 0;
      const hardCap = pnlPct >= 5; // Always sell at 5%+ regardless
      // Sell if momentum is reversing OR hit hard cap
      if (momentumNegative || hardCap) {
        const alreadySelling = decision.actions?.some(a => a.action === 'SELL' && a.token === h.token);
        if (!alreadySelling) {
          if (!decision.actions) decision.actions = [];
          const reason = hardCap
            ? `Auto take-profit (hard cap): +${pnlPct.toFixed(1)}% ($${profitUsd.toFixed(2)} profit)`
            : `Auto take-profit (momentum reversal): +${pnlPct.toFixed(1)}% ($${profitUsd.toFixed(2)} profit, 5m: ${(md.priceChange5m || 0).toFixed(2)}%)`;
          decision.actions.push({
            action: 'SELL',
            token: h.token,
            amount_usd: h.amount * md.priceUsd,
            confidence: 0.95,
            urgency: 'high',
            reason
          });
          decision.should_trade = true;
          console.log(`[CRON] ${hardCap ? 'Hard cap' : 'Momentum'} take-profit for "${agent.name}" ${h.token}: +${pnlPct.toFixed(1)}% ($${profitUsd.toFixed(2)}, 5m: ${(md.priceChange5m || 0).toFixed(2)}%)`);
        }
      }
    }
  }

  // Log the decision
  execute(
    `INSERT INTO decisions (agent_id, should_trade, reasoning, market_analysis, raw_json)
     VALUES (?, ?, ?, ?, ?)`,
    [agent.id, decision.should_trade ? 1 : 0, decision.reasoning, decision.market_analysis || "", JSON.stringify(decision)]
  );

  if (!decision.should_trade || !decision.actions?.length) {
    console.log(`[CRON] "${agent.name}" decided not to trade: ${decision.reasoning}`);
    return;
  }

  // Separate BUYs and SELLs
  const buyActions = decision.actions.filter((a) => a.action === "BUY");
  const sellActions = decision.actions.filter((a) => a.action === "SELL");

  const isPaper = agent.trading_mode === "paper";

  if (isPaper) {
    // Paper trading — simulate trades using market prices
    for (const action of sellActions) {
      try {
        executePaperSell(agent, action, agentMarketData);
      } catch (err) {
        console.error(`[CRON] Paper SELL failed for ${agent.name}/${action.token}: ${err.message}`);
        logFailedTrade(agent.id, action);
      }
    }
    for (const action of buyActions) {
      try {
        executePaperBuy(agent, action, agentMarketData);
      } catch (err) {
        console.error(`[CRON] Paper BUY failed for ${agent.name}/${action.token}: ${err.message}`);
        logFailedTrade(agent.id, action);
      }
    }
  } else {
    // Live trading — execute real trades via Odos
    const wallet = getWallet();
    if (!wallet) {
      console.warn(`[CRON] Wallet not initialized, skipping live trades for "${agent.name}"`);
      return;
    }

    for (const action of sellActions) {
      try {
        await executeSell(agent, action, agentMarketData);
      } catch (err) {
        console.error(`[CRON] SELL failed for ${agent.name}/${action.token}: ${err.message}`);
        logFailedTrade(agent.id, action);
      }
    }

    if (buyActions.length > 0) {
      try {
        await executeBundledBuys(agent, buyActions, agentMarketData);
      } catch (err) {
        console.warn(`[CRON] Bundled BUY failed for ${agent.name}: ${err.message} — falling back to individual swaps`);
        // Fallback: try each buy individually with delay to avoid 429 rate limits
        for (let i = 0; i < buyActions.length; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, 2000));
          try {
            await executeBundledBuys(agent, [buyActions[i]], agentMarketData);
          } catch (err2) {
            console.error(`[CRON] Individual BUY failed for ${agent.name}/${buyActions[i].token}: ${err2.message}`);
            logFailedTrade(agent.id, buyActions[i]);
          }
        }
      }
    }
  }
}

/**
 * Execute all BUY actions in a single Odos transaction
 */
async function executeBundledBuys(agent, buyActions, marketData) {
  // Filter valid buys with market data
  const validBuys = [];
  for (const action of buyActions) {
    const md = marketData.get(action.token);
    if (!md || !md.priceUsd || md.priceUsd <= 0) {
      console.warn(`[CRON] No market data for ${action.token}, skipping`);
      continue;
    }
    validBuys.push({ ...action, price: md.priceUsd });
  }

  if (!validBuys.length) return;

  // sanitizeDecision() already enforced budget limits, but do a final safety check
  const totalRequested = validBuys.reduce((sum, a) => sum + (a.amount_usd || 0), 0);
  if (totalRequested > agent.current_balance) {
    const scale = agent.current_balance * 0.95 / totalRequested;
    for (const a of validBuys) {
      a.amount_usd = Math.floor(a.amount_usd * scale * 100) / 100;
    }
    console.log(`[CRON] Safety scaled BUYs from $${totalRequested.toFixed(2)} to fit $${agent.current_balance.toFixed(2)}`);
  }

  // Filter out buys below $5 minimum
  const buys = validBuys.filter((a) => a.amount_usd >= 5);
  if (!buys.length) {
    console.warn(`[CRON] All BUY amounts below $5 minimum`);
    return;
  }

  const totalUsd = buys.reduce((sum, a) => sum + a.amount_usd, 0);
  console.log(`[CRON] Bundled BUY: $${totalUsd.toFixed(2)} -> ${buys.map((b) => `${b.token}($${b.amount_usd.toFixed(2)})`).join(" + ")}`);

  // Execute bundled swap: USDT -> multiple tokens in 1 tx
  const result = await executeBundledBuy(
    buys.map((b) => ({ symbol: b.token, amountUsd: b.amount_usd })),
    0.5 // slippage
  );

  // Update DB for each token
  for (const r of result.results) {
    const action = buys.find((b) => b.token === r.symbol);
    if (!action) continue;

    const amountUsd = r.amountUsd;
    const tokenAmount = r.amountOut;
    const effectivePrice = tokenAmount > 0 ? amountUsd / tokenAmount : action.price;

    // Update virtual balance
    execute("UPDATE agents SET current_balance = current_balance - ? WHERE id = ?", [amountUsd, agent.id]);
    agent.current_balance -= amountUsd;

    // Update holdings
    const existing = queryOne("SELECT * FROM holdings WHERE agent_id = ? AND token = ?", [agent.id, r.symbol]);
    if (existing) {
      const newAmount = existing.amount + tokenAmount;
      const newAvg = (existing.avg_buy_price * existing.amount + effectivePrice * tokenAmount) / newAmount;
      execute("UPDATE holdings SET amount = ?, avg_buy_price = ? WHERE id = ?", [newAmount, newAvg, existing.id]);
    } else {
      execute("INSERT INTO holdings (agent_id, token, amount, avg_buy_price) VALUES (?, ?, ?, ?)", [agent.id, r.symbol, tokenAmount, effectivePrice]);
    }

    // Log trade
    execute(
      `INSERT INTO trades (agent_id, action, token, amount_usd, price, token_amount, confidence, reasoning, tx_hash, status)
       VALUES (?, 'BUY', ?, ?, ?, ?, ?, ?, ?, 'completed')`,
      [agent.id, r.symbol, amountUsd, effectivePrice, tokenAmount, action.confidence, action.reason, result.txHash]
    );

    console.log(`[CRON] BUY ${r.symbol}: $${amountUsd.toFixed(2)} -> ${tokenAmount.toFixed(6)} tokens (tx: ${result.txHash})`);
  }
}

/**
 * Execute a single SELL via Odos
 */
async function executeSell(agent, action, marketData) {
  const { token, amount_usd, confidence, reason } = action;
  const md = marketData.get(token);
  if (!md || !md.priceUsd || md.priceUsd <= 0) {
    console.warn(`[CRON] No market data for ${token}, skipping SELL`);
    return;
  }

  const price = md.priceUsd;
  const holding = queryOne("SELECT * FROM holdings WHERE agent_id = ? AND token = ?", [agent.id, token]);
  if (!holding || holding.amount <= 0) {
    console.warn(`[CRON] No holdings to sell for ${token}`);
    return;
  }

  const maxSellUsd = holding.amount * price;
  const sellUsd = Math.min(amount_usd, maxSellUsd);
  const sellTokens = sellUsd / price;

  if (sellTokens < 0.000001) {
    console.warn(`[CRON] Amount too small for SELL ${token}`);
    return;
  }

  console.log(`[CRON] SELL ${token}: ${sellTokens.toFixed(6)} tokens via Odos...`);

  const result = await sellTokenForUSDT(token, sellTokens, 0.5);

  const actualUsdtReceived = result.amountOut;
  const effectivePrice = sellTokens > 0 ? actualUsdtReceived / sellTokens : price;
  const remainingTokens = holding.amount - sellTokens;

  // Update virtual balance
  execute("UPDATE agents SET current_balance = current_balance + ? WHERE id = ?", [actualUsdtReceived, agent.id]);
  agent.current_balance += actualUsdtReceived;

  // Update holdings
  if (remainingTokens <= 0.000001) {
    execute("DELETE FROM holdings WHERE id = ?", [holding.id]);
  } else {
    execute("UPDATE holdings SET amount = ? WHERE id = ?", [remainingTokens, holding.id]);
  }

  // Log trade
  execute(
    `INSERT INTO trades (agent_id, action, token, amount_usd, price, token_amount, confidence, reasoning, tx_hash, status)
     VALUES (?, 'SELL', ?, ?, ?, ?, ?, ?, ?, 'completed')`,
    [agent.id, token, actualUsdtReceived, effectivePrice, sellTokens, confidence, reason, result.txHash]
  );

  console.log(`[CRON] SELL ${token}: ${sellTokens.toFixed(6)} -> $${actualUsdtReceived.toFixed(2)} (tx: ${result.txHash})`);
}

/**
 * Paper trading: simulate a BUY using current market price
 */
function executePaperBuy(agent, action, marketData) {
  const md = marketData.get(action.token);
  if (!md || !md.priceUsd || md.priceUsd <= 0) {
    console.warn(`[CRON] No market data for ${action.token}, skipping paper BUY`);
    return;
  }

  const price = md.priceUsd;
  let amountUsd = action.amount_usd;

  if (amountUsd > agent.current_balance) {
    amountUsd = agent.current_balance * 0.95;
  }
  if (amountUsd < 5) return;

  const tokenAmount = amountUsd / price;

  // Update virtual balance
  execute("UPDATE agents SET current_balance = current_balance - ? WHERE id = ?", [amountUsd, agent.id]);
  agent.current_balance -= amountUsd;

  // Update holdings
  const existing = queryOne("SELECT * FROM holdings WHERE agent_id = ? AND token = ?", [agent.id, action.token]);
  if (existing) {
    const newAmount = existing.amount + tokenAmount;
    const newAvg = (existing.avg_buy_price * existing.amount + price * tokenAmount) / newAmount;
    execute("UPDATE holdings SET amount = ?, avg_buy_price = ? WHERE id = ?", [newAmount, newAvg, existing.id]);
  } else {
    execute("INSERT INTO holdings (agent_id, token, amount, avg_buy_price) VALUES (?, ?, ?, ?)", [agent.id, action.token, tokenAmount, price]);
  }

  // Log trade
  execute(
    `INSERT INTO trades (agent_id, action, token, amount_usd, price, token_amount, confidence, reasoning, tx_hash, status)
     VALUES (?, 'BUY', ?, ?, ?, ?, ?, ?, 'PAPER', 'paper')`,
    [agent.id, action.token, amountUsd, price, tokenAmount, action.confidence, action.reason]
  );

  console.log(`[CRON] PAPER BUY ${action.token}: $${amountUsd.toFixed(2)} -> ${tokenAmount.toFixed(6)} tokens @ $${price}`);
}

/**
 * Paper trading: simulate a SELL using current market price
 */
function executePaperSell(agent, action, marketData) {
  const md = marketData.get(action.token);
  if (!md || !md.priceUsd || md.priceUsd <= 0) {
    console.warn(`[CRON] No market data for ${action.token}, skipping paper SELL`);
    return;
  }

  const price = md.priceUsd;
  const holding = queryOne("SELECT * FROM holdings WHERE agent_id = ? AND token = ?", [agent.id, action.token]);
  if (!holding || holding.amount <= 0) {
    console.warn(`[CRON] No holdings to sell for ${action.token}`);
    return;
  }

  const maxSellUsd = holding.amount * price;
  const sellUsd = Math.min(action.amount_usd, maxSellUsd);
  const sellTokens = sellUsd / price;

  if (sellTokens < 0.000001) return;

  const actualUsdtReceived = sellTokens * price;
  const remainingTokens = holding.amount - sellTokens;

  // Update virtual balance
  execute("UPDATE agents SET current_balance = current_balance + ? WHERE id = ?", [actualUsdtReceived, agent.id]);
  agent.current_balance += actualUsdtReceived;

  // Update holdings
  if (remainingTokens <= 0.000001) {
    execute("DELETE FROM holdings WHERE id = ?", [holding.id]);
  } else {
    execute("UPDATE holdings SET amount = ? WHERE id = ?", [remainingTokens, holding.id]);
  }

  // Log trade
  execute(
    `INSERT INTO trades (agent_id, action, token, amount_usd, price, token_amount, confidence, reasoning, tx_hash, status)
     VALUES (?, 'SELL', ?, ?, ?, ?, ?, ?, 'PAPER', 'paper')`,
    [agent.id, action.token, actualUsdtReceived, price, sellTokens, action.confidence, action.reason]
  );

  console.log(`[CRON] PAPER SELL ${action.token}: ${sellTokens.toFixed(6)} -> $${actualUsdtReceived.toFixed(2)} @ $${price}`);
}

function logFailedTrade(agentId, action) {
  execute(
    `INSERT INTO trades (agent_id, action, token, amount_usd, price, token_amount, confidence, reasoning, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'failed')`,
    [agentId, action.action, action.token, action.amount_usd || 0, 0, 0, action.confidence, `FAILED: ${action.reason || ""}`]
  );
}
