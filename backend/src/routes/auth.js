import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { ethers } from "ethers";
import { queryOne, execute } from "../db/database.js";

const router = Router();

// POST /api/auth/check - Check if a wallet address is registered
router.post("/check", (req, res) => {
  const { wallet_address } = req.body;
  if (!wallet_address) {
    return res.status(400).json({ error: "wallet_address is required" });
  }

  const user = queryOne(
    "SELECT id, username, wallet_address, created_at FROM users WHERE wallet_address = ?",
    [wallet_address.toLowerCase()]
  );

  if (user) {
    return res.json({ registered: true, user });
  }
  res.json({ registered: false });
});

// POST /api/auth/signup - Register a new user with MetaMask signature
router.post("/signup", (req, res) => {
  const { username, wallet_address, signature, message } = req.body;

  if (!username || !wallet_address || !signature || !message) {
    return res.status(400).json({
      error: "Missing required fields: username, wallet_address, signature, message",
    });
  }

  const trimmedName = username.trim();
  if (trimmedName.length < 2 || trimmedName.length > 30) {
    return res.status(400).json({ error: "Username must be 2-30 characters" });
  }

  const lowerWallet = wallet_address.toLowerCase();

  // Verify the signature matches the wallet address
  try {
    const recoveredAddress = ethers.verifyMessage(message, signature);
    if (recoveredAddress.toLowerCase() !== lowerWallet) {
      return res.status(400).json({ error: "Signature verification failed" });
    }
  } catch (err) {
    return res.status(400).json({ error: "Invalid signature" });
  }

  // Check if wallet already registered
  const existingWallet = queryOne("SELECT id FROM users WHERE wallet_address = ?", [lowerWallet]);
  if (existingWallet) {
    return res.status(409).json({ error: "Wallet already registered" });
  }

  // Check if username taken
  const existingUsername = queryOne("SELECT id FROM users WHERE username = ?", [trimmedName]);
  if (existingUsername) {
    return res.status(409).json({ error: "Username already taken" });
  }

  const id = uuidv4();
  execute(
    "INSERT INTO users (id, username, wallet_address, signature, message) VALUES (?, ?, ?, ?, ?)",
    [id, trimmedName, lowerWallet, signature, message]
  );

  const user = queryOne("SELECT id, username, wallet_address, created_at FROM users WHERE id = ?", [id]);
  res.status(201).json({ registered: true, user });
});

export default router;
