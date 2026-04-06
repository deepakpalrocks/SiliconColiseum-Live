import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import { initDb } from "./db/database.js";
import { initWallet, getWalletAddress } from "./services/wallet.js";
import authRouter from "./routes/auth.js";
import agentsRouter from "./routes/agents.js";
import tradesRouter from "./routes/trades.js";
import leaderboardRouter from "./routes/leaderboard.js";
import tokensRouter from "./routes/tokens.js";
import walletRouter from "./routes/deposits.js";
import { evaluateAllAgents } from "./cron/trader.js";

const app = express();
const PORT = process.env.PORT || 3001;
const CRON_MINUTES = parseInt(process.env.CRON_INTERVAL_MINUTES) || 5;

app.use(cors());
app.use(express.json());

// Initialize database
await initDb();
console.log("Database initialized");

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

// Manual trigger for testing
app.post("/api/evaluate", async (_req, res) => {
  try {
    await evaluateAllAgents();
    res.json({ success: true, message: "Evaluation triggered" });
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
  });
});

// Schedule cron job
cron.schedule(`*/${CRON_MINUTES} * * * *`, () => {
  console.log(`[CRON] Running scheduled evaluation (every ${CRON_MINUTES} min)...`);
  evaluateAllAgents().catch((err) =>
    console.error("[CRON] Evaluation failed:", err.message)
  );
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`Mode: LIVE TRADING on Arbitrum One`);
  console.log(`Cron job scheduled every ${CRON_MINUTES} minutes`);
  console.log(`GROQ_API_KEY: ${process.env.GROQ_API_KEY ? "set" : "NOT SET"}`);
  console.log(`WALLET_PRIVATE_KEY: ${process.env.WALLET_PRIVATE_KEY ? "set" : "NOT SET"}`);
});
