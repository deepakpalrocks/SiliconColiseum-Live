/**
 * Cron job that evaluates trade decisions for all active agents
 * and executes REAL 4x leveraged trades via GMX v2 on Arbitrum One.
 *
 * BUY  = Open 4x leveraged long position (collateral → GMX)
 * SELL = Close leveraged position (GMX → collateral + PNL)
 *
 * Liquidation: if price drops ~25% from entry, the position is wiped (4x leverage).
 */

import { queryAll, queryOne, execute } from "../db/database.js";
import { runTradeAgent } from "../agent/agent.js";
import { fetchMultipleTokens } from "../services/market.js";
import { fetchTwitterSentiment } from "../services/sentiment.js";
import { openLongPosition, closePosition, LEVERAGE } from "../services/gmx.js";
import { getWallet } from "../services/wallet.js";
import { getGroqClient, getPoolSize } from "../services/groqPool.js";
import { fetchCryptoNews } from "../services/news.js";
import { findRelevantEvents } from "../services/rag.js";
import { fetchSocialMetrics } from "../services/social.js";
import { getGmxMarket } from "../services/tokens.js";

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

  const agents = await queryAll("SELECT * FROM agents WHERE is_active = 1");
  if (!agents.length) {
    console.log("[CRON] No active agents to evaluate");
    return;
  }

  console.log(`[CRON] Evaluating ${agents.length} active agent(s) [4x LEVERAGED]...`);

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
  const rawTokens = JSON.parse(agent.tokens);
  // Filter to only tokens that have valid GMX v2 markets
  const tokens = rawTokens.filter(t => getGmxMarket(t));
  const positions = await queryAll("SELECT * FROM positions WHERE agent_id = ?", [agent.id]);

  const agentMarketData = new Map();
  for (const t of tokens) {
    if (allMarketData.has(t)) agentMarketData.set(t, allMarketData.get(t));
  }

  // Build current positions info for the AI prompt
  const currentHoldings = positions.map((p) => ({
    token: p.token,
    amount: p.collateral_usd,        // For AI: "amount" is the collateral at risk
    avgBuyPrice: p.entry_price,
    collateralUsd: p.collateral_usd,
    sizeUsd: p.size_usd,
    leverage: p.leverage,
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
    ragEvents = await findRelevantEvents(tokens, newsData);
  } catch (err) {
    console.warn(`[CRON] RAG lookup failed for "${agent.name}": ${err.message}`);
  }
  try {
    socialData = await fetchSocialMetrics(tokens);
  } catch (err) {
    console.warn(`[CRON] Social metrics failed for "${agent.name}": ${err.message}`);
  }

  console.log(`[CRON] Running AI for "${agent.name}" (balance: $${agent.current_balance.toFixed(2)}, positions: ${positions.length}, news: ${newsData.length})...`);

  const decision = await runTradeAgent(client, cfg, agentMarketData, sentimentData || [], agent.personality, { newsData, ragEvents, socialData });

  // ═══ Liquidation check ═══
  // With 4x leverage, liquidation occurs at ~33% price drop from entry
  for (const p of positions) {
    const md = agentMarketData.get(p.token);
    if (!md || !md.priceUsd || md.priceUsd <= 0) continue;
    const liquidationPrice = p.entry_price * (1 - 1 / p.leverage);
    if (md.priceUsd <= liquidationPrice) {
      console.log(`[CRON] LIQUIDATED: "${agent.name}" ${p.token} — price $${md.priceUsd.toFixed(4)} <= liquidation $${liquidationPrice.toFixed(4)}`);
      // Remove position, collateral is lost
      await execute("DELETE FROM positions WHERE id = ?", [p.id]);
      await execute(
        `INSERT INTO trades (agent_id, action, token, amount_usd, price, token_amount, confidence, reasoning, tx_hash, status)
         VALUES (?, 'SELL', ?, ?, ?, ?, 1.0, ?, 'LIQUIDATED', 'liquidated')`,
        [agent.id, p.token, 0, md.priceUsd, p.size_usd, `LIQUIDATED: price dropped to $${md.priceUsd.toFixed(4)}, below liquidation at $${liquidationPrice.toFixed(4)}. Collateral of $${p.collateral_usd.toFixed(2)} lost.`]
      );
      // Collateral is already deducted from balance when position was opened
      continue;
    }
  }

  // Refresh positions after liquidation check
  const activePositions = await queryAll("SELECT * FROM positions WHERE agent_id = ?", [agent.id]);

  // ═══ Take-profit: if profit >= $0.25 on OG collateral, take it ═══
  const MIN_PROFIT_USD = 0.25;

  for (const p of activePositions) {
    const md = agentMarketData.get(p.token);
    if (!md || !md.priceUsd || md.priceUsd <= 0) continue;

    // PNL on OG collateral (leverage amplifies price moves)
    const pricePnlPct = ((md.priceUsd - p.entry_price) / p.entry_price) * 100;
    const collateralPnlPct = pricePnlPct * p.leverage; // % gain/loss on original collateral
    const profitUsd = (collateralPnlPct / 100) * p.collateral_usd; // $ profit on OG amount

    if (profitUsd >= MIN_PROFIT_USD) {
      const momentumNegative = (md.priceChange5m || 0) < 0;
      const hardCap = collateralPnlPct >= 5; // Always close at 5%+ gain on collateral
      if (momentumNegative || hardCap) {
        const alreadySelling = decision.actions?.some(a => a.action === 'SELL' && a.token === p.token);
        if (!alreadySelling) {
          if (!decision.actions) decision.actions = [];
          const leveragedPnlPct = pricePnlPct * p.leverage;
          const reason = hardCap
            ? `Auto take-profit (hard cap): price +${pricePnlPct.toFixed(1)}% → ${leveragedPnlPct.toFixed(1)}% on collateral ($${profitUsd.toFixed(2)} profit)`
            : `Auto take-profit (momentum reversal): price +${pricePnlPct.toFixed(1)}% → ${leveragedPnlPct.toFixed(1)}% on collateral ($${profitUsd.toFixed(2)} profit, 5m: ${(md.priceChange5m || 0).toFixed(2)}%)`;
          decision.actions.push({
            action: 'SELL',
            token: p.token,
            amount_usd: p.collateral_usd + profitUsd, // Full position value
            confidence: 0.95,
            urgency: 'high',
            reason,
          });
          decision.should_trade = true;
          console.log(`[CRON] ${hardCap ? 'Hard cap' : 'Momentum'} take-profit for "${agent.name}" ${p.token}: price +${pricePnlPct.toFixed(1)}% → $${profitUsd.toFixed(2)} profit (4x leveraged)`);
        }
      }
    }
  }

  // Log the decision
  await execute(
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
    // Paper trading — simulate leveraged positions using market prices
    for (const action of sellActions) {
      try {
        await executePaperSell(agent, action, agentMarketData);
      } catch (err) {
        console.error(`[CRON] Paper SELL failed for ${agent.name}/${action.token}: ${err.message}`);
        await logFailedTrade(agent.id, action, err);
      }
    }
    for (const action of buyActions) {
      try {
        await executePaperBuy(agent, action, agentMarketData);
      } catch (err) {
        console.error(`[CRON] Paper BUY failed for ${agent.name}/${action.token}: ${err.message}`);
        await logFailedTrade(agent.id, action, err);
      }
    }
  } else {
    // Live trading — execute via GMX v2 perpetual futures
    const wallet = getWallet();
    if (!wallet) {
      console.warn(`[CRON] Wallet not initialized, skipping live trades for "${agent.name}"`);
      return;
    }

    // Execute SELLs (close positions) first
    for (const action of sellActions) {
      try {
        await executeLiveSell(agent, action, agentMarketData);
      } catch (err) {
        console.error(`[CRON] SELL failed for ${agent.name}/${action.token}: ${err.message}`);
        await logFailedTrade(agent.id, action, err);
      }
    }

    // Execute BUYs (open positions) sequentially — GMX doesn't support bundled orders
    for (const action of buyActions) {
      try {
        await executeLiveBuy(agent, action, agentMarketData);
      } catch (err) {
        console.error(`[CRON] BUY failed for ${agent.name}/${action.token}: ${err.message}`);
        await logFailedTrade(agent.id, action, err);
      }
    }
  }
}

// ═══ Live Trading: Open 4x Long via GMX v2 ═══

async function executeLiveBuy(agent, action, marketData) {
  const { token, amount_usd, confidence, reason } = action;
  const md = marketData.get(token);
  if (!md || !md.priceUsd || md.priceUsd <= 0) {
    console.warn(`[CRON] No market data for ${token}, skipping BUY`);
    return;
  }

  const market = getGmxMarket(token);
  if (!market) {
    console.warn(`[CRON] No GMX market for ${token}, skipping BUY`);
    return;
  }

  let collateralUsd = amount_usd;
  if (collateralUsd > agent.current_balance) {
    collateralUsd = agent.current_balance * 0.95;
  }
  if (collateralUsd < 5) return;

  const price = md.priceUsd;
  const sizeUsd = collateralUsd * LEVERAGE;

  console.log(`[CRON] Opening 4x LONG ${token}: $${collateralUsd.toFixed(2)} collateral → $${sizeUsd.toFixed(2)} position via GMX...`);

  const result = await openLongPosition(token, collateralUsd, price);

  // Deduct collateral from agent balance
  await execute("UPDATE agents SET current_balance = current_balance - ? WHERE id = ?", [collateralUsd, agent.id]);
  agent.current_balance -= collateralUsd;

  // Create or update position
  const existing = await queryOne("SELECT * FROM positions WHERE agent_id = ? AND token = ?", [agent.id, token]);
  if (existing) {
    // Add to existing position (average entry price)
    const newCollateral = existing.collateral_usd + collateralUsd;
    const newSize = newCollateral * LEVERAGE;
    const newEntry = (existing.entry_price * existing.collateral_usd + price * collateralUsd) / newCollateral;
    await execute(
      "UPDATE positions SET collateral_usd = ?, size_usd = ?, entry_price = ? WHERE id = ?",
      [newCollateral, newSize, newEntry, existing.id]
    );
  } else {
    await execute(
      "INSERT INTO positions (agent_id, token, collateral_usd, size_usd, entry_price, leverage, is_long, gmx_market) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
      [agent.id, token, collateralUsd, sizeUsd, price, LEVERAGE, market.marketAddress]
    );
  }

  // Log trade
  await execute(
    `INSERT INTO trades (agent_id, action, token, amount_usd, price, token_amount, confidence, reasoning, tx_hash, status)
     VALUES (?, 'BUY', ?, ?, ?, ?, ?, ?, ?, 'completed')`,
    [agent.id, token, collateralUsd, price, sizeUsd, confidence, `[4x LONG] ${reason}`, result.txHash]
  );

  console.log(`[CRON] BUY ${token}: $${collateralUsd.toFixed(2)} collateral × 4x = $${sizeUsd.toFixed(2)} position (tx: ${result.txHash})`);
}

// ═══ Live Trading: Close Position via GMX v2 ═══

async function executeLiveSell(agent, action, marketData) {
  const { token, confidence, reason } = action;
  const md = marketData.get(token);
  if (!md || !md.priceUsd || md.priceUsd <= 0) {
    console.warn(`[CRON] No market data for ${token}, skipping SELL`);
    return;
  }

  const position = await queryOne("SELECT * FROM positions WHERE agent_id = ? AND token = ?", [agent.id, token]);
  if (!position) {
    console.warn(`[CRON] No position to close for ${token}`);
    return;
  }

  const price = md.priceUsd;
  const pricePnlPct = ((price - position.entry_price) / position.entry_price) * 100;
  const profitUsd = (pricePnlPct / 100) * position.size_usd;
  const receivedUsd = Math.max(0, position.collateral_usd + profitUsd); // Can't receive less than 0

  console.log(`[CRON] Closing 4x LONG ${token}: $${position.size_usd.toFixed(2)} position, PNL: $${profitUsd >= 0 ? '+' : ''}${profitUsd.toFixed(2)} via GMX...`);

  const result = await closePosition(token, position.size_usd, price);

  // Use the actual received amount from GMX, or our estimate if GMX returns 0
  const actualReceived = result.receivedUsd > 0 ? result.receivedUsd : receivedUsd;

  // Credit received USDT to agent balance
  await execute("UPDATE agents SET current_balance = current_balance + ? WHERE id = ?", [actualReceived, agent.id]);
  agent.current_balance += actualReceived;

  // Remove position
  await execute("DELETE FROM positions WHERE id = ?", [position.id]);

  // Log trade
  const leveragedPnlPct = pricePnlPct * position.leverage;
  await execute(
    `INSERT INTO trades (agent_id, action, token, amount_usd, price, token_amount, confidence, reasoning, tx_hash, status)
     VALUES (?, 'SELL', ?, ?, ?, ?, ?, ?, ?, 'completed')`,
    [agent.id, token, actualReceived, price, position.size_usd, confidence, `[CLOSE 4x LONG] PNL: ${leveragedPnlPct >= 0 ? '+' : ''}${leveragedPnlPct.toFixed(1)}% ($${profitUsd >= 0 ? '+' : ''}${profitUsd.toFixed(2)}). ${reason}`, result.txHash]
  );

  console.log(`[CRON] SELL ${token}: closed $${position.size_usd.toFixed(2)} position → received $${actualReceived.toFixed(2)} (PNL: $${profitUsd >= 0 ? '+' : ''}${profitUsd.toFixed(2)}, tx: ${result.txHash})`);
}

// ═══ Paper Trading: Simulate 4x Leveraged Positions ═══

async function executePaperBuy(agent, action, marketData) {
  const md = marketData.get(action.token);
  if (!md || !md.priceUsd || md.priceUsd <= 0) {
    console.warn(`[CRON] No market data for ${action.token}, skipping paper BUY`);
    return;
  }

  const price = md.priceUsd;
  let collateralUsd = action.amount_usd;

  if (collateralUsd > agent.current_balance) {
    collateralUsd = agent.current_balance * 0.95;
  }
  if (collateralUsd < 5) return;

  const sizeUsd = collateralUsd * LEVERAGE;

  // Deduct collateral from balance
  await execute("UPDATE agents SET current_balance = current_balance - ? WHERE id = ?", [collateralUsd, agent.id]);
  agent.current_balance -= collateralUsd;

  // Create or update position
  const existing = await queryOne("SELECT * FROM positions WHERE agent_id = ? AND token = ?", [agent.id, action.token]);
  if (existing) {
    const newCollateral = existing.collateral_usd + collateralUsd;
    const newSize = newCollateral * LEVERAGE;
    const newEntry = (existing.entry_price * existing.collateral_usd + price * collateralUsd) / newCollateral;
    await execute(
      "UPDATE positions SET collateral_usd = ?, size_usd = ?, entry_price = ? WHERE id = ?",
      [newCollateral, newSize, newEntry, existing.id]
    );
  } else {
    const market = getGmxMarket(action.token);
    await execute(
      "INSERT INTO positions (agent_id, token, collateral_usd, size_usd, entry_price, leverage, is_long, gmx_market) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
      [agent.id, action.token, collateralUsd, sizeUsd, price, LEVERAGE, market?.marketAddress || '']
    );
  }

  // Log trade
  await execute(
    `INSERT INTO trades (agent_id, action, token, amount_usd, price, token_amount, confidence, reasoning, tx_hash, status)
     VALUES (?, 'BUY', ?, ?, ?, ?, ?, ?, 'PAPER', 'paper')`,
    [agent.id, action.token, collateralUsd, price, sizeUsd, action.confidence, `[PAPER 4x LONG] ${action.reason}`]
  );

  console.log(`[CRON] PAPER BUY ${action.token}: $${collateralUsd.toFixed(2)} collateral × 4x = $${sizeUsd.toFixed(2)} position @ $${price}`);
}

async function executePaperSell(agent, action, marketData) {
  const md = marketData.get(action.token);
  if (!md || !md.priceUsd || md.priceUsd <= 0) {
    console.warn(`[CRON] No market data for ${action.token}, skipping paper SELL`);
    return;
  }

  const price = md.priceUsd;
  const position = await queryOne("SELECT * FROM positions WHERE agent_id = ? AND token = ?", [agent.id, action.token]);
  if (!position) {
    console.warn(`[CRON] No position to close for ${action.token}`);
    return;
  }

  // Calculate leveraged PNL
  const pricePnlPct = ((price - position.entry_price) / position.entry_price) * 100;
  const profitUsd = (pricePnlPct / 100) * position.size_usd;
  const receivedUsd = Math.max(0, position.collateral_usd + profitUsd);

  // Credit to balance
  await execute("UPDATE agents SET current_balance = current_balance + ? WHERE id = ?", [receivedUsd, agent.id]);
  agent.current_balance += receivedUsd;

  // Remove position
  await execute("DELETE FROM positions WHERE id = ?", [position.id]);

  // Log trade
  const leveragedPnlPct = pricePnlPct * position.leverage;
  await execute(
    `INSERT INTO trades (agent_id, action, token, amount_usd, price, token_amount, confidence, reasoning, tx_hash, status)
     VALUES (?, 'SELL', ?, ?, ?, ?, ?, ?, 'PAPER', 'paper')`,
    [agent.id, action.token, receivedUsd, price, position.size_usd, action.confidence, `[PAPER CLOSE 4x] PNL: ${leveragedPnlPct >= 0 ? '+' : ''}${leveragedPnlPct.toFixed(1)}% ($${profitUsd >= 0 ? '+' : ''}${profitUsd.toFixed(2)}). ${action.reason}`]
  );

  console.log(`[CRON] PAPER SELL ${action.token}: closed $${position.size_usd.toFixed(2)} position → $${receivedUsd.toFixed(2)} (PNL: $${profitUsd >= 0 ? '+' : ''}${profitUsd.toFixed(2)})`);
}

async function logFailedTrade(agentId, action, error = null) {
  const errMsg = error ? ` | ERROR: ${error.message || error}` : "";
  await execute(
    `INSERT INTO trades (agent_id, action, token, amount_usd, price, token_amount, confidence, reasoning, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'failed')`,
    [agentId, action.action, action.token, action.amount_usd || 0, 0, 0, action.confidence, `FAILED: ${action.reason || ""}${errMsg}`]
  );
}
