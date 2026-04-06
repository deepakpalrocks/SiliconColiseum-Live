/**
 * Cron job that evaluates trade decisions for all active agents
 * and executes REAL trades via Odos Router on Arbitrum One.
 */

import { queryAll, queryOne, execute } from "../db/database.js";
import { runTradeAgent } from "../agent/agent.js";
import { fetchMultipleTokens } from "../services/market.js";
import { fetchTwitterSentiment } from "../services/sentiment.js";
import { buyTokenWithUSDT, sellTokenForUSDT } from "../services/odos.js";
import { getWallet } from "../services/wallet.js";
import { getGroqClient, getPoolSize } from "../services/groqPool.js";

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
    console.warn("[CRON] No Groq API keys set, skipping evaluation");
    return;
  }

  const wallet = getWallet();
  if (!wallet) {
    console.warn("[CRON] Wallet not initialized, skipping evaluation");
    return;
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

  // Fetch sentiment per-agent (only their tokens) with rotating keys
  for (const agent of agents) {
    try {
      const agentTokens = JSON.parse(agent.tokens);
      console.log(`[CRON] Fetching sentiment for "${agent.name}" (${agentTokens.length} tokens)...`);
      const sentimentClient = getGroqClient(); // rotates key
      const sentimentData = await fetchTwitterSentiment(sentimentClient, agentTokens);
      const tradeClient = getGroqClient(); // rotates to next key
      await evaluateAgent(tradeClient, agent, marketData, sentimentData);
      // 3-second delay between agents to avoid rate limits and nonce issues
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

  const agentSentiment = sentimentData || [];

  const cfg = {
    budget: agent.current_balance,
    riskLevel: agent.risk_level,
    selectedTokens: tokens,
    currentHoldings: holdings.map((h) => ({
      token: h.token,
      amount: h.amount,
      avgBuyPrice: h.avg_buy_price,
    })),
  };

  console.log(`[CRON] Running AI for "${agent.name}" (balance: $${agent.current_balance.toFixed(2)})...`);

  const decision = await runTradeAgent(client, cfg, agentMarketData, agentSentiment, agent.personality);

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

  for (const action of decision.actions) {
    try {
      await executeRealTrade(agent, action, agentMarketData);
      // Wait between trades to avoid nonce collision
      await new Promise((r) => setTimeout(r, 5000));
    } catch (err) {
      console.error(`[CRON] Trade execution failed for ${agent.name}/${action.token}: ${err.message}`);
      // Log the failed trade
      execute(
        `INSERT INTO trades (agent_id, action, token, amount_usd, price, token_amount, confidence, reasoning, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'failed')`,
        [agent.id, action.action, action.token, action.amount_usd || 0, 0, 0, action.confidence, `FAILED: ${err.message}`]
      );
    }
  }
}

/**
 * Execute a real trade via Odos Router
 */
async function executeRealTrade(agent, action, marketData) {
  const { action: side, token, amount_usd, confidence, reason } = action;
  const md = marketData.get(token);
  if (!md) {
    console.warn(`[CRON] No market data for ${token}, skipping trade`);
    return;
  }

  const price = md.priceUsd;
  if (!price || price <= 0) {
    console.warn(`[CRON] Invalid price for ${token}, skipping`);
    return;
  }

  if (side === "BUY") {
    const amountUsd = Math.min(amount_usd, agent.current_balance);
    if (amountUsd < 0.5) {
      console.warn(`[CRON] Amount too small for BUY ${token}: $${amountUsd}`);
      return;
    }

    console.log(`[CRON] BUY ${token}: $${amountUsd.toFixed(2)} via Odos...`);

    // Execute real swap: USDT -> Token
    const result = await buyTokenWithUSDT(token, amountUsd, 1.0);

    const tokenAmount = result.amountOut;
    const effectivePrice = tokenAmount > 0 ? amountUsd / tokenAmount : price;

    // Update virtual balance
    execute("UPDATE agents SET current_balance = current_balance - ? WHERE id = ?", [amountUsd, agent.id]);
    agent.current_balance -= amountUsd;

    // Update holdings
    const existing = queryOne("SELECT * FROM holdings WHERE agent_id = ? AND token = ?", [agent.id, token]);
    if (existing) {
      const newAmount = existing.amount + tokenAmount;
      const newAvg = (existing.avg_buy_price * existing.amount + effectivePrice * tokenAmount) / newAmount;
      execute("UPDATE holdings SET amount = ?, avg_buy_price = ? WHERE id = ?", [newAmount, newAvg, existing.id]);
    } else {
      execute("INSERT INTO holdings (agent_id, token, amount, avg_buy_price) VALUES (?, ?, ?, ?)", [agent.id, token, tokenAmount, effectivePrice]);
    }

    // Log trade with tx hash
    execute(
      `INSERT INTO trades (agent_id, action, token, amount_usd, price, token_amount, confidence, reasoning, tx_hash, status)
       VALUES (?, 'BUY', ?, ?, ?, ?, ?, ?, ?, 'completed')`,
      [agent.id, token, amountUsd, effectivePrice, tokenAmount, confidence, reason, result.txHash]
    );

    console.log(`[CRON] BUY ${token}: $${amountUsd.toFixed(2)} -> ${tokenAmount.toFixed(6)} tokens (tx: ${result.txHash})`);

  } else if (side === "SELL") {
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

    // Execute real swap: Token -> USDT
    const result = await sellTokenForUSDT(token, sellTokens, 1.0);

    const actualUsdtReceived = result.amountOut;
    const effectivePrice = sellTokens > 0 ? actualUsdtReceived / sellTokens : price;
    const remainingTokens = holding.amount - sellTokens;

    // Update virtual balance with actual USDT received
    execute("UPDATE agents SET current_balance = current_balance + ? WHERE id = ?", [actualUsdtReceived, agent.id]);
    agent.current_balance += actualUsdtReceived;

    // Update holdings
    if (remainingTokens <= 0.000001) {
      execute("DELETE FROM holdings WHERE id = ?", [holding.id]);
    } else {
      execute("UPDATE holdings SET amount = ? WHERE id = ?", [remainingTokens, holding.id]);
    }

    // Log trade with tx hash
    execute(
      `INSERT INTO trades (agent_id, action, token, amount_usd, price, token_amount, confidence, reasoning, tx_hash, status)
       VALUES (?, 'SELL', ?, ?, ?, ?, ?, ?, ?, 'completed')`,
      [agent.id, token, actualUsdtReceived, effectivePrice, sellTokens, confidence, reason, result.txHash]
    );

    console.log(`[CRON] SELL ${token}: ${sellTokens.toFixed(6)} tokens -> $${actualUsdtReceived.toFixed(2)} (tx: ${result.txHash})`);
  }
}
