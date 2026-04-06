import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { queryAll, queryOne, execute } from "../db/database.js";
import { ARBITRUM_TOKENS } from "../services/tokens.js";

const router = Router();

// GET /api/agents - list all agents (optionally filter by user_id)
router.get("/", (req, res) => {
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

  const result = agents.map((a) => ({
    ...a,
    tokens: JSON.parse(a.tokens),
    holdings: queryAll("SELECT * FROM holdings WHERE agent_id = ?", [a.id]),
  }));

  res.json(result);
});

// GET /api/agents/:id - get a single agent
router.get("/:id", (req, res) => {
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

  res.json({
    ...agent,
    tokens: JSON.parse(agent.tokens),
    holdings,
    recentTrades,
    recentDecisions: recentDecisions.map((d) => ({
      ...d,
      raw_json: d.raw_json ? JSON.parse(d.raw_json) : null,
    })),
  });
});

// POST /api/agents - create a new agent
router.post("/", async (req, res) => {
  const { user_id, name, risk_level, budget, tokens, personality } = req.body;

  if (!user_id || !name || !risk_level || !budget || !tokens?.length) {
    return res.status(400).json({ error: "Missing required fields: user_id, name, risk_level, budget, tokens" });
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

  if (budget > remainingBalance) {
    return res.status(403).json({
      error: `Insufficient deposited balance. You have $${remainingBalance.toFixed(2)} available ($${availableBalance.toFixed(2)} deposited, $${totalAllocated.toFixed(2)} allocated to agents). Deposit more USDT to the shared wallet.`,
      availableBalance,
      totalAllocated,
      remainingBalance,
    });
  }

  const id = uuidv4();
  execute(
    `INSERT INTO agents (id, user_id, name, risk_level, initial_budget, current_balance, tokens, personality)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, user_id, name, risk_level, budget, budget, JSON.stringify(tokens), personality || ""]
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

export default router;
