/**
 * GMX v2 Perpetual Futures integration for 4x leveraged trading on Arbitrum One.
 * Opens/closes long positions with USDC collateral through GMX's ExchangeRouter.
 * Handles USDT↔USDC conversion since the system tracks USDT balances.
 *
 * Flow:
 *   Open:  USDT → USDC (Uniswap V3) → Deposit USDC to GMX → Open 4x Long
 *   Close: Close position on GMX → Receive USDC → USDC → USDT (Uniswap V3)
 *
 * GMX v2 orders are ASYNC — a keeper executes them 1-3 blocks after submission.
 * We wait ~10s after submission for the keeper to execute.
 */

import { ethers } from "ethers";
import { getWallet, getProvider, getWalletAddress, approveToken } from "./wallet.js";
import { USDT_ADDRESS, USDT_DECIMALS, getGmxMarket } from "./tokens.js";

// ═══ GMX v2 Contract Addresses (Arbitrum One) — updated April 2026 ═══
const EXCHANGE_ROUTER = "0x1C3fa76e6E1088bCE750f23a5BFcffa1efEF6A41";
const ORDER_VAULT     = "0x31eF83a530Fde1B38EE9A18093A333D8Bbbc40D5";
const DATA_STORE      = "0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8";
const READER          = "0x470fbC46bcC0f16532691Df360A07d8Bf5ee0789";
const ROUTER          = "0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6";

// USDC on Arbitrum (native) — used as collateral in GMX v2 markets
export const USDC_ADDRESS  = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
export const USDC_DECIMALS = 6;

// Uniswap V3 SwapRouter on Arbitrum — for USDT↔USDC stablecoin conversion
const UNISWAP_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

export const LEVERAGE = 4;
const SLIPPAGE_BPS = 100; // 1% slippage tolerance on GMX orders

// ═══ Dynamic execution fee from GMX DataStore ═══
let cachedExecFee = null;
let execFeeFetchedAt = 0;

async function getExecutionFee() {
  // Cache for 5 minutes
  if (cachedExecFee && Date.now() - execFeeFetchedAt < 5 * 60 * 1000) {
    return cachedExecFee;
  }
  try {
    const provider = getProvider();
    const dataStore = new ethers.Contract(DATA_STORE, [
      "function getUint(bytes32 key) external view returns (uint256)"
    ], provider);
    // GMX DataStore key for estimated gas fee for order execution
    const key = ethers.solidityPackedKeccak256(["string"], ["ESTIMATED_GAS_FEE_BASE_AMOUNT_V2_1"]);
    const baseFee = await dataStore.getUint(key);
    // GMX execution fee = keeper gas cost. Real orders use 0.0002-0.006 ETH.
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits("0.1", "gwei");
    // Use base gas amount from DataStore with 2x buffer, or fallback to 1.5M gas units
    const gasUnits = baseFee > 0n ? baseFee * 2n : 3000000n;
    const fee = gasUnits * gasPrice;
    // Clamp between 0.0003 ETH (min keeper cost) and 0.01 ETH
    const minFee = ethers.parseEther("0.0003");
    const maxFee = ethers.parseEther("0.01");
    cachedExecFee = fee < minFee ? minFee : fee > maxFee ? maxFee : fee;
    execFeeFetchedAt = Date.now();
    console.log(`[GMX] Execution fee: ${ethers.formatEther(cachedExecFee)} ETH (gasUnits: ${gasUnits}, gasPrice: ${ethers.formatUnits(gasPrice, "gwei")} gwei)`);
    return cachedExecFee;
  } catch (err) {
    console.warn(`[GMX] Failed to fetch execution fee, using default: ${err.message}`);
    cachedExecFee = ethers.parseEther("0.0005"); // safe fallback for Arbitrum
    execFeeFetchedAt = Date.now();
    return cachedExecFee;
  }
}

// GMX v2 Order Types
const ORDER_TYPE = {
  MarketIncrease: 2,  // Open or increase a position
  MarketDecrease: 4,  // Close or decrease a position
};

// ═══ ABIs ═══

const EXCHANGE_ROUTER_ABI = [
  "function multicall(bytes[] calldata data) external payable returns (bytes[] memory)",
  "function sendWnt(address receiver, uint256 amount) external payable",
  "function sendTokens(address token, address receiver, uint256 amount) external payable",
  "function createOrder(tuple(tuple(address receiver, address cancellationReceiver, address callbackContract, address uiFeeReceiver, address market, address initialCollateralToken, address[] swapPath) addresses, tuple(uint256 sizeDeltaUsd, uint256 initialCollateralDeltaAmount, uint256 triggerPrice, uint256 acceptablePrice, uint256 executionFee, uint256 callbackGasLimit, uint256 minOutputAmount, uint256 validFromTime) numbers, uint8 orderType, uint8 decreasePositionSwapType, bool isLong, bool shouldUnwrapNativeToken, bool autoCancel, bytes32 referralCode, bytes32[] dataList) params) external payable returns (bytes32)",
];

const READER_ABI = [
  "function getAccountPositions(address dataStore, address account, uint256 start, uint256 end) external view returns (tuple(tuple(address account, address market, address collateralToken) addresses, tuple(uint256 sizeInUsd, uint256 sizeInTokens, uint256 collateralAmount, uint256 borrowingFactor, uint256 fundingFeeAmountPerSize, uint256 longTokenClaimableFundingAmountPerSize, uint256 shortTokenClaimableFundingAmountPerSize, uint256 increasedAtBlock, uint256 decreasedAtBlock, uint256 increasedAtTime, uint256 decreasedAtTime) numbers, tuple(bool isLong) flags)[])",
];

const UNISWAP_ROUTER_ABI = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
];

// ═══ USDT ↔ USDC Conversion via Uniswap V3 ═══

async function swapStable(tokenIn, tokenOut, decimalsIn, amountUsd) {
  const wallet = getWallet();
  if (!wallet) throw new Error("Wallet not initialized");
  const amountIn = ethers.parseUnits(amountUsd.toFixed(decimalsIn), decimalsIn);

  await approveToken(tokenIn, UNISWAP_ROUTER, amountIn);

  const router = new ethers.Contract(UNISWAP_ROUTER, UNISWAP_ROUTER_ABI, wallet);
  const deadline = Math.floor(Date.now() / 1000) + 300; // 5 min
  const minOut = amountIn * 995n / 1000n; // 0.5% slippage for stablecoin pair

  const tx = await router.exactInputSingle({
    tokenIn,
    tokenOut,
    fee: 100, // 0.01% fee tier (stablecoins)
    recipient: wallet.address,
    deadline,
    amountIn,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0n,
  });

  const receipt = await tx.wait();
  return receipt;
}

async function swapUsdtToUsdc(amountUsd) {
  console.log(`[GMX] Swapping $${amountUsd.toFixed(2)} USDT → USDC...`);
  const receipt = await swapStable(USDT_ADDRESS, USDC_ADDRESS, USDT_DECIMALS, amountUsd);
  console.log(`[GMX] USDT → USDC complete: ${receipt.hash}`);
  return receipt;
}

async function swapUsdcToUsdt(amountUsdc) {
  console.log(`[GMX] Swapping $${amountUsdc.toFixed(2)} USDC → USDT...`);
  const receipt = await swapStable(USDC_ADDRESS, USDT_ADDRESS, USDC_DECIMALS, amountUsdc);
  console.log(`[GMX] USDC → USDT complete: ${receipt.hash}`);
  return receipt;
}

// Helper: get wallet USDC balance
async function getUsdcBalance() {
  const provider = getProvider();
  const addr = getWalletAddress();
  if (!provider || !addr) return 0;
  const contract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
  const balance = await contract.balanceOf(addr);
  return parseFloat(ethers.formatUnits(balance, USDC_DECIMALS));
}

// ═══ GMX v2 Position Management ═══

/**
 * Open a 4x leveraged LONG position on GMX v2.
 *
 * @param {string} tokenSymbol - Token to go long on (e.g. "WETH", "ARB")
 * @param {number} collateralUsd - Collateral in USD (what the user risks)
 * @param {number} currentPrice - Current token price for acceptable-price calc
 * @returns {{ txHash, collateralUsd, sizeUsd, leverage, entryPrice }}
 */
export async function openLongPosition(tokenSymbol, collateralUsd, currentPrice) {
  const wallet = getWallet();
  if (!wallet) throw new Error("Wallet not initialized");

  const market = getGmxMarket(tokenSymbol);
  if (!market) throw new Error(`No GMX v2 market for ${tokenSymbol}`);

  const sizeUsd = collateralUsd * LEVERAGE;
  console.log(`[GMX] Opening 4x LONG ${tokenSymbol}: $${collateralUsd.toFixed(2)} collateral → $${sizeUsd.toFixed(2)} position @ ~$${currentPrice}`);

  // Step 1: Convert USDT → USDC (only swap what's needed, use existing USDC balance)
  const existingUsdc = await getUsdcBalance();
  const needUsdc = collateralUsd - existingUsdc;
  if (needUsdc > 0.01) {
    await swapUsdtToUsdc(needUsdc);
  } else {
    console.log(`[GMX] Using existing USDC balance ($${existingUsdc.toFixed(2)}), no swap needed`);
  }

  // Step 2: Approve USDC for GMX Router
  const collateralAmount = ethers.parseUnits(collateralUsd.toFixed(USDC_DECIMALS), USDC_DECIMALS);
  await approveToken(USDC_ADDRESS, ROUTER, collateralAmount);

  // Step 3: Build order and submit via ExchangeRouter.multicall
  const exchangeRouter = new ethers.Contract(EXCHANGE_ROUTER, EXCHANGE_ROUTER_ABI, wallet);
  const iface = exchangeRouter.interface;

  // GMX uses 30-decimal precision for USD values
  const sizeDeltaUsd = ethers.parseUnits(sizeUsd.toFixed(2), 30);

  // For a long, acceptablePrice = max we'll pay (higher = more slippage)
  const acceptablePrice = ethers.parseUnits(
    (currentPrice * (1 + SLIPPAGE_BPS / 10000)).toFixed(12),
    30
  );

  const executionFee = await getExecutionFee();

  const orderParams = {
    addresses: {
      receiver: wallet.address,
      cancellationReceiver: wallet.address,
      callbackContract: ethers.ZeroAddress,
      uiFeeReceiver: ethers.ZeroAddress,
      market: market.marketAddress,
      initialCollateralToken: USDC_ADDRESS,
      swapPath: [],
    },
    numbers: {
      sizeDeltaUsd,
      initialCollateralDeltaAmount: collateralAmount,
      triggerPrice: 0n,
      acceptablePrice,
      executionFee,
      callbackGasLimit: 0n,
      minOutputAmount: 0n,
      validFromTime: 0n,
    },
    orderType: ORDER_TYPE.MarketIncrease,
    decreasePositionSwapType: 0, // NoSwap
    isLong: true,
    shouldUnwrapNativeToken: false,
    autoCancel: false,
    referralCode: ethers.ZeroHash,
    dataList: [],
  };

  // Multicall: sendWnt (execution fee) + sendTokens (collateral) + createOrder
  const sendWntCall = iface.encodeFunctionData("sendWnt", [ORDER_VAULT, executionFee]);
  const sendTokensCall = iface.encodeFunctionData("sendTokens", [USDC_ADDRESS, ORDER_VAULT, collateralAmount]);
  const createOrderCall = iface.encodeFunctionData("createOrder", [orderParams]);

  const tx = await exchangeRouter.multicall(
    [sendWntCall, sendTokensCall, createOrderCall],
    { value: executionFee }
  );

  const receipt = await tx.wait();
  console.log(`[GMX] Position order submitted: ${receipt.hash}`);

  // Wait for GMX keeper to execute (~1-3 blocks on Arbitrum)
  console.log(`[GMX] Waiting for keeper execution...`);
  await new Promise(r => setTimeout(r, 10000));

  console.log(`[GMX] Long ${tokenSymbol} opened: $${collateralUsd.toFixed(2)} x ${LEVERAGE}x = $${sizeUsd.toFixed(2)}`);

  return {
    txHash: receipt.hash,
    collateralUsd,
    sizeUsd,
    leverage: LEVERAGE,
    entryPrice: currentPrice, // Approximate — actual fill may differ slightly
  };
}

/**
 * Close a leveraged LONG position on GMX v2.
 *
 * @param {string} tokenSymbol - Token symbol
 * @param {number} sizeUsd - Full position size in USD to close
 * @param {number} currentPrice - Current token price
 * @returns {{ txHash, closedSizeUsd, receivedUsd }}
 */
export async function closePosition(tokenSymbol, sizeUsd, currentPrice) {
  const wallet = getWallet();
  if (!wallet) throw new Error("Wallet not initialized");

  const market = getGmxMarket(tokenSymbol);
  if (!market) throw new Error(`No GMX v2 market for ${tokenSymbol}`);

  console.log(`[GMX] Closing LONG ${tokenSymbol}: $${sizeUsd.toFixed(2)} position @ ~$${currentPrice}`);

  // Snapshot USDC balance before close to measure what we receive
  const usdcBefore = await getUsdcBalance();

  const exchangeRouter = new ethers.Contract(EXCHANGE_ROUTER, EXCHANGE_ROUTER_ABI, wallet);
  const iface = exchangeRouter.interface;

  const sizeDeltaUsd = ethers.parseUnits(sizeUsd.toFixed(2), 30);

  // For closing a long, acceptablePrice = min we'll accept (lower = more slippage tolerance)
  const acceptablePrice = ethers.parseUnits(
    (currentPrice * (1 - SLIPPAGE_BPS / 10000)).toFixed(12),
    30
  );

  const executionFee = await getExecutionFee();

  const orderParams = {
    addresses: {
      receiver: wallet.address,
      cancellationReceiver: wallet.address,
      callbackContract: ethers.ZeroAddress,
      uiFeeReceiver: ethers.ZeroAddress,
      market: market.marketAddress,
      initialCollateralToken: USDC_ADDRESS,
      swapPath: [],
    },
    numbers: {
      sizeDeltaUsd,
      initialCollateralDeltaAmount: 0n, // Withdraw all remaining collateral
      triggerPrice: 0n,
      acceptablePrice,
      executionFee,
      callbackGasLimit: 0n,
      minOutputAmount: 0n,
      validFromTime: 0n,
    },
    orderType: ORDER_TYPE.MarketDecrease,
    decreasePositionSwapType: 0, // NoSwap — receive USDC
    isLong: true,
    shouldUnwrapNativeToken: false,
    autoCancel: false,
    referralCode: ethers.ZeroHash,
    dataList: [],
  };

  const sendWntCall = iface.encodeFunctionData("sendWnt", [ORDER_VAULT, executionFee]);
  const createOrderCall = iface.encodeFunctionData("createOrder", [orderParams]);

  const tx = await exchangeRouter.multicall(
    [sendWntCall, createOrderCall],
    { value: executionFee }
  );

  const receipt = await tx.wait();
  console.log(`[GMX] Close order submitted: ${receipt.hash}`);

  // Wait for keeper execution
  await new Promise(r => setTimeout(r, 10000));

  // Measure USDC received (collateral + PNL)
  const usdcAfter = await getUsdcBalance();
  const usdcReceived = Math.max(0, usdcAfter - usdcBefore);

  // Convert USDC back to USDT
  let usdtReceived = 0;
  if (usdcReceived > 0.01) {
    await swapUsdcToUsdt(usdcReceived);
    usdtReceived = usdcReceived; // ~1:1 for stablecoins
  }

  console.log(`[GMX] Position closed. Received: ~$${usdtReceived.toFixed(2)} USDT`);

  return {
    txHash: receipt.hash,
    closedSizeUsd: sizeUsd,
    receivedUsd: usdtReceived,
  };
}

/**
 * Read all open GMX v2 positions for the wallet (on-chain).
 */
export async function getOpenPositions() {
  const provider = getProvider();
  const addr = getWalletAddress();
  if (!provider || !addr) return [];

  try {
    const reader = new ethers.Contract(READER, READER_ABI, provider);
    const positions = await reader.getAccountPositions(DATA_STORE, addr, 0, 100);

    return positions.map(p => ({
      market: p.addresses.market,
      collateralToken: p.addresses.collateralToken,
      sizeInUsd: parseFloat(ethers.formatUnits(p.numbers.sizeInUsd, 30)),
      sizeInTokens: parseFloat(ethers.formatUnits(p.numbers.sizeInTokens, 18)),
      collateralAmount: parseFloat(ethers.formatUnits(p.numbers.collateralAmount, USDC_DECIMALS)),
      isLong: p.flags.isLong,
    }));
  } catch (err) {
    console.error(`[GMX] Failed to read on-chain positions: ${err.message}`);
    return [];
  }
}
