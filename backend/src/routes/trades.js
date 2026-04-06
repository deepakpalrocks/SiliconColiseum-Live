import { Router } from "express";
import { queryAll, queryOne } from "../db/database.js";

const router = Router();

// GET /api/trades/:agentId - get trades for an agent
router.get("/:agentId", (req, res) => {
  const { limit = "50", offset = "0" } = req.query;

  const trades = queryAll(
    "SELECT * FROM trades WHERE agent_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [req.params.agentId, parseInt(limit), parseInt(offset)]
  );

  const total = queryOne(
    "SELECT COUNT(*) as count FROM trades WHERE agent_id = ?",
    [req.params.agentId]
  );

  res.json({ trades, total: total?.count || 0 });
});

// GET /api/trades - get all recent trades across all agents
router.get("/", (_req, res) => {
  const trades = queryAll(
    `SELECT t.*, a.name as agent_name
     FROM trades t
     JOIN agents a ON t.agent_id = a.id
     ORDER BY t.created_at DESC LIMIT 100`
  );
  res.json(trades);
});

export default router;
