import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import { initDb } from "./db/database.js";
import { initWallet, getWalletAddress } from "./services/wallet.js";
import { initGroqPool, getPoolSize, getPoolStatus } from "./services/groqPool.js";
import authRouter from "./routes/auth.js";
import agentsRouter from "./routes/agents.js";
import tradesRouter from "./routes/trades.js";
import leaderboardRouter from "./routes/leaderboard.js";
import tokensRouter from "./routes/tokens.js";
import walletRouter from "./routes/deposits.js";
import { evaluateAllAgents } from "./cron/trader.js";
import { learnFromNews } from "./cron/news-learner.js";
import { seedHistoricalEvents } from "./data/seed-events.js";

const app = express();
const PORT = process.env.PORT || 3001;
const CRON_MINUTES = parseInt(process.env.CRON_INTERVAL_MINUTES) || 15;

app.use(cors());
app.use(express.json());

// Initialize database
await initDb();
console.log("Database initialized");

// Seed historical events for RAG memory
seedHistoricalEvents();

// Initialize LLM provider (DeepSeek V3)
await initGroqPool();

// Initialize shared trading wallet
const wallet = initWallet();
if (wallet) {
  console.log(`Trading wallet: ${wallet.address}`);
} else {
  console.warn("WARNING: No WALLET_PRIVATE_KEY set - real trading is disabled!");
}

// Routes
app.use("/api/auth", authRouter);
app.use("/api/tokens", tokensRouter);
app.use("/api/agents", agentsRouter);
app.use("/api/trades", tradesRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/wallet", walletRouter);

// Evaluate endpoint - works as both manual trigger AND external cron target
// Use GET so external cron services (cron-job.org) can hit it easily
app.post("/api/evaluate", async (_req, res) => {
  try {
    await evaluateAllAgents();
    res.json({ success: true, message: "Evaluation triggered" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/evaluate", async (_req, res) => {
  try {
    await evaluateAllAgents();
    res.json({ success: true, message: "Evaluation triggered via GET" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual trigger: learn from news
app.post("/api/learn", async (_req, res) => {
  try {
    await learnFromNews();
    res.json({ success: true, message: "News learning triggered" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/api/health", async (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    wallet: getWalletAddress() || "not configured",
    chain: "Arbitrum One",
    mode: "LIVE TRADING",
    llmPool: getPoolStatus(),
  });
});

// Schedule internal cron job (works when server stays alive, e.g. VPS/Railway)
// For free tiers that sleep (Render), use external cron service hitting GET /api/evaluate
const USE_INTERNAL_CRON = process.env.USE_INTERNAL_CRON !== "false";
if (USE_INTERNAL_CRON) {
  cron.schedule(`*/${CRON_MINUTES} * * * *`, () => {
    console.log(`[CRON] Running scheduled evaluation (every ${CRON_MINUTES} min)...`);
    evaluateAllAgents().catch((err) =>
      console.error("[CRON] Evaluation failed:", err.message)
    );
  });

  // Auto-learn from news every 6 hours — grows RAG memory automatically
  cron.schedule("0 */6 * * *", () => {
    console.log("[LEARNER] Running news learning cycle...");
    learnFromNews().catch((err) =>
      console.error("[LEARNER] Failed:", err.message)
    );
  });
}

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`Mode: LIVE TRADING on Arbitrum One`);
  console.log(`Internal cron: ${USE_INTERNAL_CRON ? `every ${CRON_MINUTES} min` : "DISABLED (use external cron)"}`);
  console.log(`DEEPSEEK_API_KEY: ${process.env.DEEPSEEK_API_KEY ? "set" : "NOT SET"}`);
  console.log(`News feed: CryptoCompare (free, no key needed)`);
  console.log(`WALLET_PRIVATE_KEY: ${process.env.WALLET_PRIVATE_KEY ? "set" : "NOT SET"}`);
});
