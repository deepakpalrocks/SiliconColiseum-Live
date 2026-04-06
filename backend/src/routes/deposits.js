import { Router } from "express";
import { ethers } from "ethers";
import { queryOne, queryAll, execute } from "../db/database.js";
import { getWalletAddress, getUsdtBalance, getEthBalance, getProvider } from "../services/wallet.js";
import { USDT_ADDRESS } from "../services/tokens.js";

const router = Router();

const USDT_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

// Retry helper for flaky RPC calls
async function withRetry(fn, retries = 3, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`[RPC] Attempt ${i + 1} failed: ${err.message}, retrying in ${delayMs}ms...`);
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs *= 2; // exponential backoff
    }
  }
}

// GET /api/wallet/info - get shared wallet address and balances
router.get("/info", async (_req, res) => {
  try {
    const address = getWalletAddress();
    if (!address) {
      return res.status(503).json({ error: "Wallet not configured" });
    }

    const [usdtBalance, ethBalance] = await Promise.all([
      getUsdtBalance(),
      getEthBalance(),
    ]);

    res.json({
      address,
      usdtBalance,
      ethBalance,
      chain: "Arbitrum One",
      chainId: 42161,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/wallet/balance/:userId - get user's virtual balance
router.get("/balance/:userId", (req, res) => {
  const balance = queryOne("SELECT usdt_balance FROM user_balances WHERE user_id = ?", [req.params.userId]);
  const deposits = queryAll(
    "SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
    [req.params.userId]
  );

  // Calculate allocated to agents
  const allocated = queryOne(
    "SELECT COALESCE(SUM(initial_budget), 0) as total FROM agents WHERE user_id = ?",
    [req.params.userId]
  );

  res.json({
    usdt_balance: balance?.usdt_balance || 0,
    allocated: allocated?.total || 0,
    available: (balance?.usdt_balance || 0) - (allocated?.total || 0),
    deposits,
  });
});

// POST /api/wallet/confirm-deposit - confirm a USDT deposit by tx hash
router.post("/confirm-deposit", async (req, res) => {
  const { user_id, tx_hash } = req.body;

  if (!user_id || !tx_hash) {
    return res.status(400).json({ error: "Missing user_id or tx_hash" });
  }

  // Check user exists
  const user = queryOne("SELECT * FROM users WHERE id = ?", [user_id]);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  // Check if already processed
  const existing = queryOne("SELECT * FROM deposits WHERE tx_hash = ?", [tx_hash]);
  if (existing) {
    return res.status(409).json({ error: "Deposit already processed", deposit: existing });
  }

  const walletAddress = getWalletAddress();
  if (!walletAddress) {
    return res.status(503).json({ error: "Wallet not configured" });
  }

  try {
    const provider = getProvider();
    const receipt = await withRetry(() => provider.getTransactionReceipt(tx_hash));

    if (!receipt) {
      return res.status(404).json({ error: "Transaction not found or not yet confirmed" });
    }

    if (receipt.status !== 1) {
      return res.status(400).json({ error: "Transaction failed" });
    }

    // Parse USDT Transfer events
    const usdtInterface = new ethers.Interface(USDT_ABI);
    let depositAmount = 0;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== USDT_ADDRESS.toLowerCase()) continue;
      try {
        const parsed = usdtInterface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === "Transfer") {
          const to = parsed.args[1].toLowerCase();
          if (to === walletAddress.toLowerCase()) {
            // USDT has 6 decimals
            depositAmount += parseFloat(ethers.formatUnits(parsed.args[2], 6));
          }
        }
      } catch {
        continue;
      }
    }

    if (depositAmount <= 0) {
      return res.status(400).json({ error: "No USDT transfer to the shared wallet found in this transaction" });
    }

    // Record deposit
    execute(
      "INSERT INTO deposits (user_id, tx_hash, amount, status) VALUES (?, ?, ?, 'confirmed')",
      [user_id, tx_hash, depositAmount]
    );

    // Update user balance
    const currentBalance = queryOne("SELECT usdt_balance FROM user_balances WHERE user_id = ?", [user_id]);
    if (currentBalance) {
      execute(
        "UPDATE user_balances SET usdt_balance = usdt_balance + ?, updated_at = datetime('now') WHERE user_id = ?",
        [depositAmount, user_id]
      );
    } else {
      execute(
        "INSERT INTO user_balances (user_id, usdt_balance) VALUES (?, ?)",
        [user_id, depositAmount]
      );
    }

    const newBalance = queryOne("SELECT usdt_balance FROM user_balances WHERE user_id = ?", [user_id]);

    res.json({
      success: true,
      amount: depositAmount,
      new_balance: newBalance?.usdt_balance || depositAmount,
      tx_hash,
    });
  } catch (err) {
    console.error("Deposit confirmation error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/wallet/deposits/:userId - list user's deposit history
router.get("/deposits/:userId", (req, res) => {
  const deposits = queryAll(
    "SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at DESC",
    [req.params.userId]
  );
  res.json(deposits);
});

export default router;
