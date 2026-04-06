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
export async function sendTransaction(txData) {
  if (!wallet) throw new Error("Wallet not initialized");

  const tx = await wallet.sendTransaction({
    to: txData.to,
    data: txData.data,
    value: txData.value || 0n,
    gasLimit: txData.gasLimit ? BigInt(Math.ceil(Number(txData.gasLimit) * 1.2)) : undefined,
  });

  const receipt = await tx.wait();
  return receipt;
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
