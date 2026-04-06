/**
 * Odos Router integration for optimal swap execution on Arbitrum One.
 * https://docs.odos.xyz/
 */

import { ethers } from "ethers";
import { getWalletAddress, approveToken, sendTransaction } from "./wallet.js";
import { USDT_ADDRESS, USDT_DECIMALS, getTokenAddress, getTokenDecimals } from "./tokens.js";

const ODOS_API_BASE = "https://api.odos.xyz";
const ARBITRUM_CHAIN_ID = 42161;

// Odos Router v2 on Arbitrum One
const ODOS_ROUTER_ADDRESS = "0xa669e7A0d4b3e4Fa48af2dE86BD4CD7126Be4e13";

/**
 * Get a swap quote from Odos
 * @param {string} inputTokenAddress - Input token contract address
 * @param {number} inputDecimals - Input token decimals
 * @param {string} outputTokenAddress - Output token contract address
 * @param {number} outputDecimals - Output token decimals
 * @param {number} amountIn - Human-readable amount to swap
 * @param {number} slippagePercent - Slippage tolerance (default 0.5%)
 * @returns {Object} Quote response with pathId
 */
export async function getQuote(inputTokenAddress, inputDecimals, outputTokenAddress, outputDecimals, amountIn, slippagePercent = 0.5) {
  const walletAddress = getWalletAddress();
  if (!walletAddress) throw new Error("Wallet not initialized");

  const amountInWei = ethers.parseUnits(String(amountIn), inputDecimals).toString();

  const body = {
    chainId: ARBITRUM_CHAIN_ID,
    inputTokens: [
      {
        tokenAddress: inputTokenAddress,
        amount: amountInWei,
      },
    ],
    outputTokens: [
      {
        tokenAddress: outputTokenAddress,
        proportion: 1,
      },
    ],
    userAddr: walletAddress,
    slippageLimitPercent: slippagePercent,
    referralCode: 0,
    disableRFQs: false,
    compact: true,
  };

  const response = await fetch(`${ODOS_API_BASE}/sor/quote/v2`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Odos quote failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  if (!data.pathId) {
    throw new Error("No pathId in Odos quote response");
  }

  return {
    pathId: data.pathId,
    amountIn: amountInWei,
    amountOut: data.outAmounts?.[0] || "0",
    amountOutReadable: data.outAmounts?.[0]
      ? parseFloat(ethers.formatUnits(data.outAmounts[0], outputDecimals))
      : 0,
    gasEstimate: data.gasEstimate || 0,
    priceImpact: data.percentDiff || 0,
  };
}

/**
 * Assemble the swap transaction from a quote
 * @param {string} pathId - From getQuote response
 * @returns {Object} Assembled transaction data
 */
export async function assembleSwap(pathId) {
  const walletAddress = getWalletAddress();
  if (!walletAddress) throw new Error("Wallet not initialized");

  const body = {
    userAddr: walletAddress,
    pathId: pathId,
    simulate: false,
  };

  const response = await fetch(`${ODOS_API_BASE}/sor/assemble`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Odos assemble failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  if (!data.transaction) {
    throw new Error("No transaction in Odos assemble response");
  }

  return data.transaction;
}

/**
 * Execute a full swap: quote -> approve -> assemble -> send
 * @param {string} inputSymbol - Input token symbol (e.g. "USDT")
 * @param {string} outputSymbol - Output token symbol (e.g. "WETH")
 * @param {number} amountIn - Human-readable amount to swap
 * @param {number} slippagePercent - Slippage tolerance
 * @returns {Object} { txHash, amountIn, amountOut, ... }
 */
export async function executeSwap(inputSymbol, outputSymbol, amountIn, slippagePercent = 0.5) {
  // Resolve addresses
  const inputAddress = inputSymbol === "USDT" ? USDT_ADDRESS : getTokenAddress(inputSymbol);
  const outputAddress = outputSymbol === "USDT" ? USDT_ADDRESS : getTokenAddress(outputSymbol);
  const inputDecimals = inputSymbol === "USDT" ? USDT_DECIMALS : getTokenDecimals(inputSymbol);
  const outputDecimals = outputSymbol === "USDT" ? USDT_DECIMALS : getTokenDecimals(outputSymbol);

  if (!inputAddress) throw new Error(`Unknown input token: ${inputSymbol}`);
  if (!outputAddress) throw new Error(`Unknown output token: ${outputSymbol}`);

  console.log(`[ODOS] Getting quote: ${amountIn} ${inputSymbol} -> ${outputSymbol}`);

  // Step 1: Get quote
  const quote = await getQuote(
    inputAddress, inputDecimals,
    outputAddress, outputDecimals,
    amountIn, slippagePercent
  );

  console.log(`[ODOS] Quote: ${amountIn} ${inputSymbol} -> ${quote.amountOutReadable} ${outputSymbol} (impact: ${quote.priceImpact}%)`);

  // Step 2: Approve input token for Odos router
  const amountInWei = ethers.parseUnits(String(amountIn), inputDecimals);
  await approveToken(inputAddress, ODOS_ROUTER_ADDRESS, amountInWei);

  // Step 3: Assemble transaction
  const txData = await assembleSwap(quote.pathId);

  // Step 4: Execute transaction
  console.log(`[ODOS] Executing swap...`);
  const receipt = await sendTransaction(txData);

  console.log(`[ODOS] Swap complete: ${receipt.hash}`);

  return {
    txHash: receipt.hash,
    inputSymbol,
    outputSymbol,
    amountIn,
    amountOut: quote.amountOutReadable,
    priceImpact: quote.priceImpact,
    gasUsed: receipt.gasUsed?.toString() || "0",
    blockNumber: receipt.blockNumber,
  };
}

/**
 * Buy a token with USDT
 */
export async function buyTokenWithUSDT(tokenSymbol, usdtAmount, slippage = 0.5) {
  return executeSwap("USDT", tokenSymbol, usdtAmount, slippage);
}

/**
 * Sell a token for USDT
 */
export async function sellTokenForUSDT(tokenSymbol, tokenAmount, slippage = 0.5) {
  return executeSwap(tokenSymbol, "USDT", tokenAmount, slippage);
}

export { ODOS_ROUTER_ADDRESS };
