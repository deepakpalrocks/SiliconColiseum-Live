import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { queryAll, queryOne, execute } from "../db/database.js";
import { ARBITRUM_TOKENS } from "../services/tokens.js";
import { fetchMultipleTokens } from "../services/market.js";
import { sellTokenForUSDT } from "../services/odos.js";
import { getWallet, transferUSDT } from "../services/wallet.js";

const router = Router();

/**
 * Enrich holdings with current market prices and compute PNL
 */
function computeAgentPnl(agent, holdings, prices) {
  let holdingsValue = 0;
  const enrichedHoldings = holdings.map((h) => {
    const marketData = prices.get(h.token);
    const currentPrice = marketData?.priceUsd || 0;
    const value = currentPrice * h.amount;
    holdingsValue += value;
    return {
      ...h,
      current_price: currentPrice,
      value,
      pnl_percent:
        currentPrice > 0 && h.avg_buy_price > 0
          ? ((currentPrice - h.avg_buy_price) / h.avg_buy_price) * 100
          : 0,
    };
  });

  const totalValue = agent.current_balance + holdingsValue;
  const pnl = totalValue - agent.initial_budget;
  const pnlPercent = agent.initial_budget > 0 ? (pnl / agent.initial_budget) * 100 : 0;

  return {
    holdings: enrichedHoldings,
    holdings_value: holdingsValue,
    total_value: totalValue,
    pnl,
    pnl_percent: pnlPercent,
  };
}

// GET /api/agents - list all agents (optionally filter by user_id)
router.get("/", async (req, res) => {
  try {
    const { user_id } = req.query;

    let agents;
    if (user_id) {
      agents = queryAll(
        `SELECT a.*, u.username as owner FROM agents a
         LEFT JOIN users u ON a.user_id = u.id
         WHERE a.user_id = ? ORDER BY a.created_at DESC`,
        [user_id]
      );
    } else {
      agents = queryAll(
        `SELECT a.*, u.username as owner FROM agents a
         LEFT JOIN users u ON a.user_id = u.id
         ORDER BY a.created_at DESC`
      );
    }

    // Collect all holdings and unique tokens for price fetch
    const allHoldings = new Map();
    const uniqueTokens = new Set();
    for (const a of agents) {
      const holdings = queryAll("SELECT * FROM holdings WHERE agent_id = ?", [a.id]);
      allHoldings.set(a.id, holdings);
      for (const h of holdings) uniqueTokens.add(h.token);
    }

    // Fetch live prices once for all tokens
    let prices = new Map();
    if (uniqueTokens.size > 0) {
      try {
        prices = await fetchMultipleTokens([...uniqueTokens]);
      } catch (err) {
        console.warn("[AGENTS] Failed to fetch prices for PNL:", err.message);
      }
    }

    const result = agents.map((a) => {
      const holdings = allHoldings.get(a.id) || [];
      const pnlData = computeAgentPnl(a, holdings, prices);
      return {
        ...a,
        tokens: JSON.parse(a.tokens),
        ...pnlData,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("Agents list error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agents/:id - get a single agent
router.get("/:id", async (req, res) => {
  try {
    const agent = queryOne(
      `SELECT a.*, u.username as owner FROM agents a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE a.id = ?`,
      [req.params.id]
    );
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const holdings = queryAll("SELECT * FROM holdings WHERE agent_id = ?", [agent.id]);
    const recentTrades = queryAll(
      "SELECT * FROM trades WHERE agent_id = ? ORDER BY created_at DESC LIMIT 20",
      [agent.id]
    );
    const recentDecisions = queryAll(
      "SELECT * FROM decisions WHERE agent_id = ? ORDER BY created_at DESC LIMIT 10",
      [agent.id]
    );

    // Fetch live prices for PNL
    const uniqueTokens = [...new Set(holdings.map((h) => h.token))];
    let prices = new Map();
    if (uniqueTokens.length > 0) {
      try {
        prices = await fetchMultipleTokens(uniqueTokens);
      } catch (err) {
        console.warn("[AGENTS] Failed to fetch prices for PNL:", err.message);
      }
    }

    const pnlData = computeAgentPnl(agent, holdings, prices);

    res.json({
      ...agent,
      tokens: JSON.parse(agent.tokens),
      ...pnlData,
      recentTrades,
      recentDecisions: recentDecisions.map((d) => ({
        ...d,
        raw_json: d.raw_json ? JSON.parse(d.raw_json) : null,
      })),
    });
  } catch (err) {
    console.error("Agent detail error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agents - create a new agent
router.post("/", async (req, res) => {
  const { user_id, name, risk_level, budget, tokens, personality, trading_mode } = req.body;

  if (!user_id || !name || !risk_level || !budget || !tokens?.length) {
    return res.status(400).json({ error: "Missing required fields: user_id, name, risk_level, budget, tokens" });
  }

  const mode = trading_mode || "live";
  if (mode !== "paper" && mode !== "live") {
    return res.status(400).json({ error: "trading_mode must be 'paper' or 'live'" });
  }

  const validRisks = ["conservative", "balanced", "aggressive", "degen"];
  if (!validRisks.includes(risk_level)) {
    return res.status(400).json({ error: `risk_level must be one of: ${validRisks.join(", ")}` });
  }

  const validSymbols = ARBITRUM_TOKENS.map((t) => t.symbol);
  const invalidTokens = tokens.filter((t) => !validSymbols.includes(t));
  if (invalidTokens.length) {
    return res.status(400).json({ error: `Invalid tokens: ${invalidTokens.join(", ")}` });
  }

  if (budget < 1 || budget > 100000) {
    return res.status(400).json({ error: "Budget must be between $1 and $100,000" });
  }

  // Verify user exists
  const user = queryOne("SELECT id, wallet_address FROM users WHERE id = ?", [user_id]);
  if (!user) {
    return res.status(401).json({ error: "You must sign up before creating an agent" });
  }

  // Check user's deposited USDT balance
  const userBalance = queryOne("SELECT usdt_balance FROM user_balances WHERE user_id = ?", [user_id]);
  const availableBalance = userBalance?.usdt_balance || 0;

  // Calculate total already allocated to agents
  const allocated = queryOne(
    "SELECT COALESCE(SUM(initial_budget), 0) as total FROM agents WHERE user_id = ?",
    [user_id]
  );
  const totalAllocated = allocated?.total || 0;
  const remainingBalance = availableBalance - totalAllocated;

  // Paper mode agents don't require deposited balance (budget is virtual)
  if (mode === "live" && budget > remainingBalance) {
    return res.status(403).json({
      error: `Insufficient deposited balance. You have $${remainingBalance.toFixed(2)} available ($${availableBalance.toFixed(2)} deposited, $${totalAllocated.toFixed(2)} allocated to agents). Deposit more USDT to the shared wallet.`,
      availableBalance,
      totalAllocated,
      remainingBalance,
    });
  }

  const id = uuidv4();
  execute(
    `INSERT INTO agents (id, user_id, name, risk_level, initial_budget, current_balance, tokens, personality, trading_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, user_id, name, risk_level, budget, budget, JSON.stringify(tokens), personality || "", mode]
  );

  const agent = queryOne("SELECT * FROM agents WHERE id = ?", [id]);
  res.status(201).json({ ...agent, tokens: JSON.parse(agent.tokens), holdings: [] });
});

// PATCH /api/agents/:id/toggle - activate/deactivate
router.patch("/:id/toggle", (req, res) => {
  const { user_id } = req.body;
  const agent = queryOne("SELECT * FROM agents WHERE id = ?", [req.params.id]);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  if (!user_id || agent.user_id !== user_id) {
    return res.status(403).json({ error: "Only the owner can toggle this agent" });
  }

  const newState = agent.is_active ? 0 : 1;
  execute("UPDATE agents SET is_active = ? WHERE id = ?", [newState, agent.id]);
  res.json({ ...agent, is_active: newState, tokens: JSON.parse(agent.tokens) });
});

// DELETE /api/agents/:id
router.delete("/:id", (req, res) => {
  const { user_id } = req.body;
  const agent = queryOne("SELECT * FROM agents WHERE id = ?", [req.params.id]);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  if (!user_id || agent.user_id !== user_id) {
    return res.status(403).json({ error: "Only the owner can delete this agent" });
  }

  // Return the agent's remaining balance to user's available balance
  // (The initial_budget was "allocated" at creation, now we free it up minus any losses)
  // Note: current_balance represents remaining USDT, holdings are token positions

  execute("DELETE FROM trades WHERE agent_id = ?", [agent.id]);
  execute("DELETE FROM holdings WHERE agent_id = ?", [agent.id]);
  execute("DELETE FROM decisions WHERE agent_id = ?", [agent.id]);
  execute("DELETE FROM agents WHERE id = ?", [agent.id]);
  res.json({ success: true });
});

// POST /api/agents/:id/exit - sell all holdings, transfer USDT to owner wallet
router.post("/:id/exit", async (req, res) => {
  const { user_id } = req.body;
  const agent = queryOne("SELECT * FROM agents WHERE id = ?", [req.params.id]);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  if (!user_id || agent.user_id !== user_id) {
    return res.status(403).json({ error: "Only the owner can exit this agent" });
  }

  const user = queryOne("SELECT wallet_address FROM users WHERE id = ?", [user_id]);
  if (!user?.wallet_address) {
    return res.status(400).json({ error: "No wallet address found for user" });
  }

  // Deactivate immediately to prevent new trades
  execute("UPDATE agents SET is_active = 0 WHERE id = ?", [agent.id]);

  const holdings = queryAll("SELECT * FROM holdings WHERE agent_id = ?", [agent.id]);
  const isPaper = agent.trading_mode === "paper";
  let totalProceeds = agent.current_balance;
  const sellResults = [];

  // Sell all holdings
  for (const h of holdings) {
    if (h.amount <= 0.000001) continue;

    try {
      if (isPaper) {
        // Paper: use market price for virtual liquidation
        const prices = await fetchMultipleTokens([h.token]);
        const md = prices.get(h.token);
        const price = md?.priceUsd || h.avg_buy_price;
        const proceeds = h.amount * price;
        totalProceeds += proceeds;
        sellResults.push({ token: h.token, proceeds, status: "paper" });
      } else {
        // Live: sell via Odos
        const result = await sellTokenForUSDT(h.token, h.amount, 0.5);
        const proceeds = result.amountOut;
        totalProceeds += proceeds;
        sellResults.push({ token: h.token, proceeds, txHash: result.txHash, status: "completed" });

        // Log the exit trade
        execute(
          `INSERT INTO trades (agent_id, action, token, amount_usd, price, token_amount, confidence, reasoning, tx_hash, status)
           VALUES (?, 'SELL', ?, ?, ?, ?, 1.0, 'Exit strategy - full liquidation', ?, 'completed')`,
          [agent.id, h.token, proceeds, proceeds / h.amount, h.amount, result.txHash]
        );
      }
    } catch (err) {
      console.error(`[EXIT] Failed to sell ${h.token}: ${err.message}`);
      sellResults.push({ token: h.token, proceeds: 0, status: "failed", error: err.message });
    }
  }

  // Transfer USDT to owner wallet (live mode only)
  let transferResult = null;
  if (!isPaper && totalProceeds > 0.01) {
    try {
      const wallet = getWallet();
      if (!wallet) throw new Error("Wallet not initialized");
      transferResult = await transferUSDT(user.wallet_address, totalProceeds);
    } catch (err) {
      console.error(`[EXIT] USDT transfer failed: ${err.message}`);
      return res.status(500).json({
        error: `Holdings sold but transfer failed: ${err.message}. USDT is still in the shared wallet. Contact support.`,
        sellResults,
        totalProceeds,
      });
    }
  }

  // Clean up agent data
  execute("DELETE FROM holdings WHERE agent_id = ?", [agent.id]);
  execute("UPDATE agents SET current_balance = 0 WHERE id = ?", [agent.id]);

  // Record withdrawal
  if (transferResult) {
    execute(
      `INSERT INTO withdrawals (user_id, to_address, amount, tx_hash, status)
       VALUES (?, ?, ?, ?, 'completed')`,
      [user_id, user.wallet_address, totalProceeds, transferResult.txHash]
    );
  }

  res.json({
    success: true,
    totalProceeds: parseFloat(totalProceeds.toFixed(2)),
    toAddress: user.wallet_address,
    txHash: transferResult?.txHash || null,
    isPaper,
    sellResults,
  });
});

export default router;
