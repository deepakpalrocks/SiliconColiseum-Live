import { Router } from "express";
import { queryAll, queryOne } from "../db/database.js";
import { fetchMultipleTokens } from "../services/market.js";

const router = Router();

// GET /api/leaderboard - ranked agents by PnL
router.get("/", async (_req, res) => {
  try {
    const agents = queryAll(
      `SELECT a.*, u.username as owner FROM agents a
       LEFT JOIN users u ON a.user_id = u.id
       ORDER BY a.created_at DESC`
    );
    if (!agents.length) return res.json([]);

    // Collect all holdings and unique tokens
    const allHoldings = new Map();
    const uniqueTokens = new Set();

    for (const agent of agents) {
      const holdings = queryAll("SELECT * FROM holdings WHERE agent_id = ?", [agent.id]);
      allHoldings.set(agent.id, holdings);
      for (const h of holdings) uniqueTokens.add(h.token);
    }

    // Fetch current prices
    let prices = new Map();
    if (uniqueTokens.size > 0) {
      prices = await fetchMultipleTokens([...uniqueTokens]);
    }

    // Calculate PnL for each agent
    const leaderboard = agents.map((agent) => {
      const holdings = allHoldings.get(agent.id) || [];
      let holdingsValue = 0;

      const holdingsDetail = holdings.map((h) => {
        const marketData = prices.get(h.token);
        const currentPrice = marketData?.priceUsd || 0;
        const value = currentPrice * h.amount;
        holdingsValue += value;
        return {
          token: h.token,
          amount: h.amount,
          avgBuyPrice: h.avg_buy_price,
          currentPrice,
          value,
          pnlPercent:
            currentPrice > 0
              ? ((currentPrice - h.avg_buy_price) / h.avg_buy_price) * 100
              : 0,
        };
      });

      const totalValue = agent.current_balance + holdingsValue;
      const pnl = totalValue - agent.initial_budget;
      const pnlPercent = agent.initial_budget > 0 ? (pnl / agent.initial_budget) * 100 : 0;

      const tradeCount = queryOne(
        "SELECT COUNT(*) as count FROM trades WHERE agent_id = ?",
        [agent.id]
      );

      return {
        id: agent.id,
        name: agent.name,
        owner: agent.owner || "Unknown",
        risk_level: agent.risk_level,
        initial_budget: agent.initial_budget,
        current_balance: agent.current_balance,
        holdings_value: holdingsValue,
        total_value: totalValue,
        pnl,
        pnl_percent: pnlPercent,
        trade_count: tradeCount?.count || 0,
        is_active: agent.is_active,
        created_at: agent.created_at,
        holdings: holdingsDetail,
      };
    });

    leaderboard.sort((a, b) => b.pnl_percent - a.pnl_percent);
    leaderboard.forEach((entry, i) => { entry.rank = i + 1; });

    res.json(leaderboard);
  } catch (err) {
    console.error("Leaderboard error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
