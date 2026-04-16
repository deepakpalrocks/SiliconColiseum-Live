/**
 * Shared wallet management for executing trades on Arbitrum One.
 * Uses a single private key to manage trades for all users.
 */

import { ethers } from "ethers";
import { USDT_ADDRESS, USDT_DECIMALS, getTokenAddress, getTokenDecimals } from "./tokens.js";

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

let provider;
let wallet;

export function initWallet() {
  const rpcUrl = process.env.RPC_URL || "https://arb1.arbitrum.io/rpc";
  const privateKey = process.env.WALLET_PRIVATE_KEY;

  if (!privateKey) {
    console.warn("[WALLET] No WALLET_PRIVATE_KEY set - real trading disabled");
    return null;
  }

  provider = new ethers.JsonRpcProvider(rpcUrl);
  wallet = new ethers.Wallet(privateKey, provider);

  console.log(`[WALLET] Initialized wallet: ${wallet.address}`);
  return wallet;
}

export function getWallet() {
  return wallet;
}

export function getProvider() {
  return provider;
}

export function getWalletAddress() {
  return wallet?.address || null;
}

/**
 * Get ETH balance (for gas)
 */
export async function getEthBalance() {
  if (!wallet) return 0;
  const balance = await provider.getBalance(wallet.address);
  return parseFloat(ethers.formatEther(balance));
}

/**
 * Get USDT balance of the shared wallet
 */
export async function getUsdtBalance() {
  if (!wallet) return 0;
  const contract = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);
  const balance = await contract.balanceOf(wallet.address);
  return parseFloat(ethers.formatUnits(balance, USDT_DECIMALS));
}

/**
 * Get token balance by symbol
 */
export async function getTokenBalance(symbol) {
  if (!wallet) return 0;
  const address = getTokenAddress(symbol);
  if (!address) return 0;

  const decimals = getTokenDecimals(symbol);
  const contract = new ethers.Contract(address, ERC20_ABI, provider);
  const balance = await contract.balanceOf(wallet.address);
  return parseFloat(ethers.formatUnits(balance, decimals));
}

/**
 * Approve a token for spending by the Odos router
 */
export async function approveToken(tokenAddress, spender, amount) {
  if (!wallet) throw new Error("Wallet not initialized");

  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

  // Check current allowance
  const currentAllowance = await contract.allowance(wallet.address, spender);
  if (currentAllowance >= amount) {
    return null; // Already approved
  }

  // Approve max uint256 to avoid repeated approvals
  const maxApproval = ethers.MaxUint256;
  const tx = await contract.approve(spender, maxApproval);
  const receipt = await tx.wait();
  console.log(`[WALLET] Approved ${tokenAddress} for ${spender} - tx: ${receipt.hash}`);
  return receipt;
}

/**
 * Send a raw transaction (used for Odos assembled swaps)
 */
// Max gas cost in USD before skipping a trade
const MAX_GAS_COST_USD = parseFloat(process.env.MAX_GAS_COST_USD || "0.005");

export async function sendTransaction(txData) {
  if (!wallet) throw new Error("Wallet not initialized");

  // Estimate gas units
  let gasLimit;
  const rawGas = txData.gasLimit || txData.gas;
  if (rawGas) {
    gasLimit = BigInt(Math.ceil(Number(rawGas) * 1.3));
  } else {
    try {
      const estimated = await wallet.estimateGas({
        to: txData.to,
        data: txData.data,
        value: txData.value || 0n,
      });
      gasLimit = estimated * 130n / 100n;
    } catch (err) {
      console.warn(`[WALLET] Gas estimation failed, using default 500K: ${err.message}`);
      gasLimit = 500000n;
    }
  }

  // Check estimated gas cost in USD before sending
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || 0n;
  const estimatedCostWei = gasLimit * gasPrice;
  const estimatedCostEth = parseFloat(ethers.formatEther(estimatedCostWei));

  // Fetch ETH price from a simple heuristic (Arbitrum gas is cheap)
  // Use coingecko-free or fallback to a reasonable estimate
  const ethPriceUsd = await getEthPriceUsd();
  const estimatedCostUsd = estimatedCostEth * ethPriceUsd;

  console.log(`[WALLET] Gas estimate: ${gasLimit} units, ~$${estimatedCostUsd.toFixed(4)} (limit: $${MAX_GAS_COST_USD})`);

  if (estimatedCostUsd > MAX_GAS_COST_USD) {
    throw new Error(`Gas too expensive: $${estimatedCostUsd.toFixed(4)} > $${MAX_GAS_COST_USD} limit. Skipping trade.`);
  }

  const tx = await wallet.sendTransaction({
    to: txData.to,
    data: txData.data,
    value: txData.value || 0n,
    gasLimit,
  });

  const receipt = await tx.wait();
  return receipt;
}

// Cache ETH price for 10 minutes
let cachedEthPrice = { usd: 2000, fetchedAt: 0 };

async function getEthPriceUsd() {
  const now = Date.now();
  if (now - cachedEthPrice.fetchedAt < 10 * 60 * 1000) {
    return cachedEthPrice.usd;
  }

  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
    const data = await res.json();
    cachedEthPrice = { usd: data.ethereum.usd, fetchedAt: now };
    return cachedEthPrice.usd;
  } catch {
    // Fallback to cached or default
    return cachedEthPrice.usd;
  }
}

/**
 * Get all token balances for the wallet
 */
export async function getAllTokenBalances(symbols) {
  if (!wallet) return {};

  const results = {};
  const promises = symbols.map(async (symbol) => {
    try {
      results[symbol] = await getTokenBalance(symbol);
    } catch {
      results[symbol] = 0;
    }
  });

  await Promise.all(promises);
  return results;
}
