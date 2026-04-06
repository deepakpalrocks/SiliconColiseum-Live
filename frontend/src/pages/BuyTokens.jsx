import { useState, useEffect, useCallback } from "react";
import { BrowserProvider, Contract, parseUnits } from "ethers";
import { useAuth } from "../context/AuthContext";
import { getWalletInfo, confirmDeposit } from "../api/client";
import {
  USDT_CONTRACT_ADDRESS,
  USDT_ABI,
  ARBITRUM_CHAIN_ID,
  ARBITRUM_CHAIN_ID_HEX,
  ARBITRUM_CHAIN_CONFIG,
} from "../config/contract";

export default function BuyTokens() {
  const { walletAddress, user, isRegistered, userBalance, refreshBalance } = useAuth();
  const [sharedWallet, setSharedWallet] = useState(null);
  const [usdtBalance, setUsdtBalance] = useState(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [txStatus, setTxStatus] = useState("");
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [manualTxHash, setManualTxHash] = useState("");

  // Load shared wallet info
  useEffect(() => {
    getWalletInfo()
      .then(setSharedWallet)
      .catch(() => setSharedWallet(null));
  }, []);

  const loadUsdtBalance = useCallback(async () => {
    if (!walletAddress || !window.ethereum) return;
    try {
      const provider = new BrowserProvider(window.ethereum);
      const usdtContract = new Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, provider);
      const bal = await usdtContract.balanceOf(walletAddress);
      setUsdtBalance(Number(bal) / 1e6);
    } catch {
      setUsdtBalance(0);
    }
  }, [walletAddress]);

  useEffect(() => {
    loadUsdtBalance();
  }, [loadUsdtBalance]);

  async function ensureArbitrumNetwork() {
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (parseInt(chainId, 16) !== ARBITRUM_CHAIN_ID) {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ARBITRUM_CHAIN_ID_HEX }],
        });
      } catch (switchError) {
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [ARBITRUM_CHAIN_CONFIG],
          });
        } else {
          throw switchError;
        }
      }
    }
  }

  async function handleDeposit() {
    setError("");
    setTxStatus("");
    setTxHash("");

    const amount = parseFloat(depositAmount);
    if (!amount || amount < 1) {
      setError("Minimum deposit is 1 USDT");
      return;
    }

    if (!sharedWallet?.address) {
      setError("Shared wallet not configured on the server");
      return;
    }

    setSending(true);
    try {
      await ensureArbitrumNetwork();

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const usdtContract = new Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, signer);

      const usdtAmount = parseUnits(String(amount), 6);

      setTxStatus("Sending USDT to shared trading wallet... (confirm in MetaMask)");
      const tx = await usdtContract.transfer(sharedWallet.address, usdtAmount);
      setTxStatus("Waiting for confirmation...");
      const receipt = await tx.wait();

      setTxHash(receipt.hash);
      setTxStatus("Confirming deposit with server...");

      // Auto-confirm with backend
      await confirmDeposit(user.id, receipt.hash);
      await refreshBalance();
      await loadUsdtBalance();

      setTxStatus("Deposit confirmed!");
      setDepositAmount("");
      setTimeout(() => setTxStatus(""), 5000);
    } catch (err) {
      const msg = err.reason || err.message || "Transaction failed";
      setError(msg.length > 200 ? msg.slice(0, 200) + "..." : msg);
    } finally {
      setSending(false);
    }
  }

  async function handleManualConfirm() {
    if (!manualTxHash.trim()) return;
    setConfirming(true);
    setError("");
    try {
      await confirmDeposit(user.id, manualTxHash.trim());
      await refreshBalance();
      setManualTxHash("");
      setTxStatus("Deposit confirmed!");
      setTimeout(() => setTxStatus(""), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setConfirming(false);
    }
  }

  if (!isRegistered) {
    return (
      <div className="text-center py-20 bg-dark-800 rounded-lg border border-dark-600 max-w-2xl mx-auto">
        <p className="text-gray-400 text-lg mb-2">Authentication Required</p>
        <p className="text-gray-600 text-sm">
          Connect your wallet and sign up to deposit funds.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-2">Deposit USDT</h1>
      <p className="text-gray-500 text-sm mb-6">
        Deposit USDT to the shared trading wallet. Your AI agents will use these funds to execute real trades on Arbitrum One via Odos Router.
      </p>

      {/* Balance cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-dark-800 border border-dark-600 rounded-lg p-4">
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Your USDT (Wallet)</p>
          <p className="text-2xl font-bold text-white font-mono">
            {usdtBalance !== null ? usdtBalance.toFixed(2) : "..."}
          </p>
          <p className="text-gray-600 text-xs mt-1">in your MetaMask</p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-lg p-4">
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Deposited Balance</p>
          <p className="text-2xl font-bold text-accent-green font-mono">
            ${userBalance.usdt_balance.toFixed(2)}
          </p>
          <p className="text-gray-600 text-xs mt-1">${userBalance.allocated.toFixed(2)} allocated</p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-lg p-4">
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Available</p>
          <p className="text-2xl font-bold text-yellow-400 font-mono">
            ${userBalance.available.toFixed(2)}
          </p>
          <p className="text-gray-600 text-xs mt-1">for new agents</p>
        </div>
      </div>

      {/* Shared wallet info */}
      {sharedWallet && (
        <div className="bg-dark-800 border border-dark-600 rounded-lg p-4 mb-6">
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-2">Shared Trading Wallet</p>
          <div className="flex items-center gap-2">
            <p className="text-sm text-gray-300 font-mono break-all flex-1">{sharedWallet.address}</p>
            <button
              onClick={() => navigator.clipboard.writeText(sharedWallet.address)}
              className="px-2 py-1 text-xs bg-dark-700 border border-dark-500 rounded text-gray-400 hover:text-white hover:bg-dark-600 transition-colors shrink-0"
            >
              Copy
            </button>
          </div>
          <div className="flex gap-4 mt-2 text-xs text-gray-500">
            <span>Chain: {sharedWallet.chain}</span>
            <span>USDT Pool: ${sharedWallet.usdtBalance?.toFixed(2)}</span>
            <span>ETH (gas): {sharedWallet.ethBalance?.toFixed(4)}</span>
          </div>
        </div>
      )}

      {/* Deposit form */}
      <div className="bg-dark-800 border border-dark-600 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">Quick Deposit</h2>
        <div className="flex gap-3 mb-4">
          <div className="flex-1">
            <input
              type="number"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="Amount in USDT"
              min={1}
              step={1}
              className="w-full bg-dark-900 border border-dark-600 rounded px-3 py-2.5 text-white font-mono placeholder-gray-600 focus:outline-none focus:border-accent-green/50"
            />
          </div>
          <button
            onClick={handleDeposit}
            disabled={sending || !depositAmount}
            className="px-6 py-2.5 bg-accent-green/20 border border-accent-green/30 rounded text-accent-green font-medium hover:bg-accent-green/30 disabled:opacity-50 transition-colors"
          >
            {sending ? "Sending..." : "Deposit"}
          </button>
        </div>
        <div className="flex gap-2">
          {[10, 50, 100, 500, 1000].map((amt) => (
            <button
              key={amt}
              onClick={() => setDepositAmount(String(amt))}
              className="px-3 py-1 bg-dark-700 border border-dark-600 rounded text-sm text-gray-400 hover:text-white hover:bg-dark-600 transition-colors font-mono"
            >
              ${amt}
            </button>
          ))}
        </div>
      </div>

      {/* Manual tx confirmation */}
      <div className="bg-dark-800 border border-dark-600 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-2">Manual Deposit Confirmation</h2>
        <p className="text-gray-500 text-xs mb-3">
          Already sent USDT directly? Paste the transaction hash to confirm your deposit.
        </p>
        <div className="flex gap-3">
          <input
            type="text"
            value={manualTxHash}
            onChange={(e) => setManualTxHash(e.target.value)}
            placeholder="0x... transaction hash"
            className="flex-1 bg-dark-900 border border-dark-600 rounded px-3 py-2 text-white font-mono text-sm placeholder-gray-600 focus:outline-none focus:border-accent-green/50"
          />
          <button
            onClick={handleManualConfirm}
            disabled={confirming || !manualTxHash.trim()}
            className="px-4 py-2 bg-dark-700 border border-dark-500 rounded text-sm text-gray-300 hover:bg-dark-600 disabled:opacity-50 transition-colors"
          >
            {confirming ? "Confirming..." : "Confirm"}
          </button>
        </div>
      </div>

      {txStatus && (
        <div className="bg-dark-800 border border-accent-green/30 rounded p-3 mb-4">
          <p className="text-accent-green text-sm">{txStatus}</p>
          {txHash && (
            <a
              href={`https://arbiscan.io/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:underline font-mono break-all"
            >
              {txHash}
            </a>
          )}
        </div>
      )}

      {error && (
        <div className="bg-dark-800 border border-accent-red/30 rounded p-3 mb-4">
          <p className="text-accent-red text-sm">{error}</p>
        </div>
      )}

      <div className="bg-dark-800 border border-dark-600 rounded-lg p-4 text-xs text-gray-500 space-y-1">
        <p className="text-accent-red font-medium">WARNING: This platform executes REAL trades with REAL money.</p>
        <p>Deposits are made in USDT on Arbitrum One network to the shared trading wallet.</p>
        <p>Your AI agents will use Odos Router to execute optimal swaps on Arbitrum.</p>
        <p>Trading involves risk. Only deposit what you can afford to lose.</p>
      </div>
    </div>
  );
}
