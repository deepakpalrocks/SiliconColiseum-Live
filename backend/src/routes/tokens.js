import { Router } from "express";
import { fetchMultipleTokens } from "../services/market.js";
import { ARBITRUM_TOKENS, TOKEN_CATEGORIES, getTradeableTokens } from "../services/tokens.js";

const router = Router();

// GET /api/tokens - list all available tokens with Arbitrum addresses
router.get("/", (_req, res) => {
  res.json(ARBITRUM_TOKENS.map(t => ({
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    decimals: t.decimals,
    category: t.category,
    categoryLabel: TOKEN_CATEGORIES[t.category] || t.category,
  })));
});

// GET /api/tokens/tradeable - only non-stable tokens for agent selection
router.get("/tradeable", (_req, res) => {
  const tokens = getTradeableTokens();
  res.json(tokens.map(t => ({
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    category: t.category,
    categoryLabel: TOKEN_CATEGORIES[t.category] || t.category,
  })));
});

// GET /api/tokens/categories - list categories
router.get("/categories", (_req, res) => {
  res.json(TOKEN_CATEGORIES);
});

// GET /api/tokens/prices - get live prices for all tokens
router.get("/prices", async (_req, res) => {
  try {
    const symbols = ARBITRUM_TOKENS.map((t) => t.symbol);
    const marketData = await fetchMultipleTokens(symbols);
    const prices = {};
    for (const [sym, data] of marketData) {
      prices[sym] = data;
    }
    res.json(prices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
export { ARBITRUM_TOKENS as AVAILABLE_TOKENS };
