import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { BrowserProvider } from "ethers";
import { checkWallet, signup as apiSignup, getUserBalance } from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [walletAddress, setWalletAddress] = useState(null);
  const [user, setUser] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [userBalance, setUserBalance] = useState({ usdt_balance: 0, allocated: 0, available: 0 });

  useEffect(() => {
    async function checkExisting() {
      if (!window.ethereum) return;
      try {
        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        if (accounts.length > 0) {
          const addr = accounts[0];
          setWalletAddress(addr);
          const result = await checkWallet(addr);
          if (result.registered) {
            setUser(result.user);
          }
        }
      } catch {
        // silently fail
      }
    }
    checkExisting();

    if (window.ethereum) {
      const handler = (accounts) => {
        if (accounts.length === 0) {
          setWalletAddress(null);
          setUser(null);
        } else {
          const addr = accounts[0];
          setWalletAddress(addr);
          checkWallet(addr).then((result) => {
            setUser(result.registered ? result.user : null);
          }).catch(() => setUser(null));
        }
      };
      window.ethereum.on("accountsChanged", handler);
      return () => window.ethereum.removeListener("accountsChanged", handler);
    }
  }, []);

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      throw new Error("MetaMask is not installed");
    }
    setConnecting(true);
    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      const addr = accounts[0];
      setWalletAddress(addr);

      const result = await checkWallet(addr);
      if (result.registered) {
        setUser(result.user);
      }
      return { address: addr, registered: result.registered, user: result.user };
    } finally {
      setConnecting(false);
    }
  }, []);

  const signUp = useCallback(
    async (username) => {
      if (!window.ethereum || !walletAddress) {
        throw new Error("Wallet not connected");
      }

      const message = `I confirm to sign in the wallet ${walletAddress} with my name ${username} on the Silicon Colesium Live Trading app`;

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(message);

      const result = await apiSignup({
        username,
        wallet_address: walletAddress,
        signature,
        message,
      });

      setUser(result.user);
      return result.user;
    },
    [walletAddress]
  );

  const refreshBalance = useCallback(async () => {
    if (!user?.id) return;
    try {
      const balance = await getUserBalance(user.id);
      setUserBalance(balance);
    } catch {
      setUserBalance({ usdt_balance: 0, allocated: 0, available: 0 });
    }
  }, [user]);

  useEffect(() => {
    if (user?.id) {
      refreshBalance();
      const interval = setInterval(refreshBalance, 30000);
      return () => clearInterval(interval);
    }
  }, [user, refreshBalance]);

  const disconnect = useCallback(() => {
    setWalletAddress(null);
    setUser(null);
    setUserBalance({ usdt_balance: 0, allocated: 0, available: 0 });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        walletAddress,
        user,
        connecting,
        userBalance,
        isConnected: !!walletAddress,
        isRegistered: !!user,
        connectWallet,
        signUp,
        disconnect,
        refreshBalance,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
