/**
 * Odos Router integration for optimal swap execution on Arbitrum One.
 * Supports bundled multi-output swaps (1 USDT tx → multiple tokens).
 * Tries v3 enterprise API first, simulates tx, falls back to v2 if v3 reverts.
 * https://docs.odos.xyz/
 */

import { ethers } from "ethers";
import { getWalletAddress, getProvider, approveToken, sendTransaction } from "./wallet.js";
import { USDT_ADDRESS, USDT_DECIMALS, getTokenAddress, getTokenDecimals } from "./tokens.js";

const ODOS_API_KEY = process.env.ODOS_API_KEY || "";
const ARBITRUM_CHAIN_ID = 42161;

const V3 = {
  label: "v3",
  base: "https://enterprise-api.odos.xyz",
  quotePath: "/sor/quote/v3",
  headers: () => ({ "Content-Type": "application/json", "x-api-key": ODOS_API_KEY }),
};

const V2 = {
  label: "v2",
  base: "https://api.odos.xyz",
  quotePath: "/sor/quote/v2",
  headers: () => ({ "Content-Type": "application/json" }),
};

if (ODOS_API_KEY) {
  console.log("[ODOS] Using v3 enterprise API (v2 fallback enabled)");
} else {
  console.warn("[ODOS] No ODOS_API_KEY set — using v2 API only");
}

// Odos Router addresses
const ODOS_ROUTER_V2 = "0xa669e7A0d4b3e4Fa48af2dE86BD4CD7126Be4e13";
const ODOS_ROUTER_V3 = "0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05";
const ODOS_ROUTER_ADDRESS = ODOS_API_KEY ? ODOS_ROUTER_V3 : ODOS_ROUTER_V2;

/**
 * Get a swap quote from Odos using a specific API version.
 */
async function getQuoteRaw(inputTokens, outputTokens, slippagePercent, api) {
  const walletAddress = getWalletAddress();
  if (!walletAddress) throw new Error("Wallet not initialized");

  const body = {
    chainId: ARBITRUM_CHAIN_ID,
    inputTokens: inputTokens.map((t) => ({
      tokenAddress: t.address,
      amount: ethers.parseUnits(String(t.amount), t.decimals).toString(),
    })),
    outputTokens: outputTokens.map((t) => ({
      tokenAddress: t.address,
      proportion: t.proportion,
    })),
    userAddr: walletAddress,
    slippageLimitPercent: slippagePercent,
    referralCode: 0,
    disableRFQs: false,
    compact: true,
  };

  const MAX_RETRIES = 4;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(`${api.base}${api.quotePath}`, {
      method: "POST",
      headers: api.headers(),
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.pathId) {
        if (attempt > 1) console.log(`[ODOS] ${api.label} quote succeeded on attempt ${attempt}`);
        return data;
      }
    }

    const errText = await response.text().catch(() => "unknown");
    const isRetryable = response.status === 429 || response.status >= 500
      || errText.includes("2998") || errText.includes("2999");

    if (!isRetryable || attempt === MAX_RETRIES) {
      throw new Error(`Odos ${api.label} quote failed (${response.status}): ${errText}`);
    }

    const delay = 2000 + 1500 * attempt;
    console.warn(`[ODOS] ${api.label} quote attempt ${attempt} failed (${response.status}), retrying in ${delay / 1000}s...`);
    await new Promise((r) => setTimeout(r, delay));
  }
}

/**
 * Assemble the swap transaction from a pathId (single attempt).
 */
async function assembleSwapOnce(pathId, api) {
  const walletAddress = getWalletAddress();
  if (!walletAddress) throw new Error("Wallet not initialized");

  const response = await fetch(`${api.base}/sor/assemble`, {
    method: "POST",
    headers: api.headers(),
    body: JSON.stringify({ userAddr: walletAddress, pathId, simulate: false }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown");
    const err = new Error(`Odos ${api.label} assemble failed (${response.status}): ${errText}`);
    err.retryable = response.status === 429 || response.status >= 500 || errText.includes("3110");
    throw err;
  }

  const data = await response.json();
  if (!data.transaction) {
    throw new Error(`No transaction in Odos ${api.label} assemble response`);
  }

  return data.transaction;
}

/**
 * Simulate a transaction with eth_call to check if it would revert.
 * Returns true if simulation succeeds, false if it reverts.
 */
async function simulateTx(txData) {
  const provider = getProvider();
  if (!provider) return true; // Skip simulation if no provider

  try {
    await provider.call({
      to: txData.to,
      data: txData.data,
      value: txData.value || "0",
      from: txData.from || getWalletAddress(),
    });
    return true;
  } catch (err) {
    console.warn(`[ODOS] Simulation reverted: ${err.message?.substring(0, 120)}`);
    return false;
  }
}

/**
 * Full quote → assemble → simulate with v3→v2 fallback.
 * If v3 assembles but simulation shows revert, falls back to v2.
 */
async function quoteAssembleAndVerify(inputTokens, outputTokens, slippagePercent = 0.5) {
  const apis = ODOS_API_KEY ? [V3, V2] : [V2];

  for (const api of apis) {
    const MAX_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const quoteData = await getQuoteRaw(inputTokens, outputTokens, slippagePercent, api);
        const txData = await assembleSwapOnce(quoteData.pathId, api);

        // Simulate before returning — catches on-chain reverts without spending gas
        const simOk = await simulateTx(txData);
        if (!simOk) {
          const err = new Error(`${api.label} transaction would revert (simulation failed)`);
          err.retryable = true;
          throw err;
        }

        if (attempt > 1 || api === V2) {
          console.log(`[ODOS] ${api.label} quote+assemble+simulate OK (attempt ${attempt})`);
        }
        return { quoteData, txData };
      } catch (err) {
        const canRetry = err.retryable && attempt < MAX_ATTEMPTS;
        if (canRetry) {
          const delay = 4000 + 3000 * attempt;
          console.warn(`[ODOS] ${api.label} attempt ${attempt}/${MAX_ATTEMPTS} failed, retrying in ${delay / 1000}s... (${err.message})`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        // If this API version is exhausted, try the next one
        if (apis.indexOf(api) < apis.length - 1) {
          console.warn(`[ODOS] ${api.label} exhausted after ${attempt} attempts, trying next... (${err.message})`);
          break;
        }

        throw err;
      }
    }
  }

  throw new Error("All Odos API versions exhausted");
}

/**
 * Execute a single swap: one input → one output
 */
export async function executeSwap(inputSymbol, outputSymbol, amountIn, slippagePercent = 0.5) {
  const inputAddress = inputSymbol === "USDT" ? USDT_ADDRESS : getTokenAddress(inputSymbol);
  const outputAddress = outputSymbol === "USDT" ? USDT_ADDRESS : getTokenAddress(outputSymbol);
  const inputDecimals = inputSymbol === "USDT" ? USDT_DECIMALS : getTokenDecimals(inputSymbol);
  const outputDecimals = outputSymbol === "USDT" ? USDT_DECIMALS : getTokenDecimals(outputSymbol);

  if (!inputAddress) throw new Error(`Unknown input token: ${inputSymbol}`);
  if (!outputAddress) throw new Error(`Unknown output token: ${outputSymbol}`);

  console.log(`[ODOS] Getting quote: ${amountIn} ${inputSymbol} -> ${outputSymbol}`);

  const { quoteData, txData } = await quoteAssembleAndVerify(
    [{ address: inputAddress, decimals: inputDecimals, amount: amountIn }],
    [{ address: outputAddress, proportion: 1 }],
    slippagePercent
  );

  const amountOutReadable = quoteData.outAmounts?.[0]
    ? parseFloat(ethers.formatUnits(quoteData.outAmounts[0], outputDecimals))
    : 0;

  console.log(`[ODOS] Quote: ${amountIn} ${inputSymbol} -> ${amountOutReadable} ${outputSymbol}`);

  // Approve input token for the router from the assemble response
  const amountInWei = ethers.parseUnits(String(amountIn), inputDecimals);
  await approveToken(inputAddress, txData.to, amountInWei);

  // Execute — simulation already passed, this should succeed
  console.log(`[ODOS] Executing swap...`);
  const receipt = await sendTransaction(txData);
  console.log(`[ODOS] Swap complete: ${receipt.hash}`);

  return {
    txHash: receipt.hash,
    inputSymbol,
    outputSymbol,
    amountIn,
    amountOut: amountOutReadable,
    gasUsed: receipt.gasUsed?.toString() || "0",
  };
}

/**
 * Bundled BUY: USDT → multiple tokens in a single transaction.
 */
export async function executeBundledBuy(buys, slippagePercent = 0.5) {
  if (!buys.length) throw new Error("No buys to execute");

  // Single buy — use simple swap
  if (buys.length === 1) {
    const b = buys[0];
    const result = await executeSwap("USDT", b.symbol, b.amountUsd, slippagePercent);
    return {
      txHash: result.txHash,
      results: [{ symbol: b.symbol, amountUsd: b.amountUsd, amountOut: result.amountOut }],
    };
  }

  const totalUsd = buys.reduce((sum, b) => sum + b.amountUsd, 0);

  const outputTokens = buys.map((b) => {
    const address = getTokenAddress(b.symbol);
    if (!address) throw new Error(`Unknown token: ${b.symbol}`);
    return {
      address,
      decimals: getTokenDecimals(b.symbol),
      proportion: b.amountUsd / totalUsd,
      symbol: b.symbol,
      amountUsd: b.amountUsd,
    };
  });

  console.log(`[ODOS] Bundled BUY: $${totalUsd.toFixed(2)} USDT -> ${buys.map((b) => `${b.symbol}($${b.amountUsd})`).join(" + ")}`);

  const { quoteData, txData } = await quoteAssembleAndVerify(
    [{ address: USDT_ADDRESS, decimals: USDT_DECIMALS, amount: totalUsd }],
    outputTokens.map((t) => ({ address: t.address, proportion: t.proportion })),
    slippagePercent
  );

  const results = outputTokens.map((t, i) => {
    const amountOut = quoteData.outAmounts?.[i]
      ? parseFloat(ethers.formatUnits(quoteData.outAmounts[i], t.decimals))
      : 0;
    console.log(`[ODOS]   ${t.symbol}: $${t.amountUsd.toFixed(2)} -> ${amountOut.toFixed(6)} tokens`);
    return { symbol: t.symbol, amountUsd: t.amountUsd, amountOut };
  });

  // Approve total USDT for the router from the assemble response
  const totalWei = ethers.parseUnits(String(totalUsd), USDT_DECIMALS);
  await approveToken(USDT_ADDRESS, txData.to, totalWei);

  // Execute — simulation already passed
  console.log(`[ODOS] Executing bundled swap (${buys.length} tokens in 1 tx)...`);
  const receipt = await sendTransaction(txData);
  console.log(`[ODOS] Bundled swap complete: ${receipt.hash}`);

  return {
    txHash: receipt.hash,
    results,
  };
}

/**
 * Buy a token with USDT (single swap)
 */
export async function buyTokenWithUSDT(tokenSymbol, usdtAmount, slippage = 0.5) {
  return executeSwap("USDT", tokenSymbol, usdtAmount, slippage);
}

/**
 * Sell a token for USDT (single swap)
 */
export async function sellTokenForUSDT(tokenSymbol, tokenAmount, slippage = 0.5) {
  return executeSwap(tokenSymbol, "USDT", tokenAmount, slippage);
}

export { ODOS_ROUTER_ADDRESS };
