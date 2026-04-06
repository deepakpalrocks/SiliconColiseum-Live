import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";

export default function Navbar() {
  const location = useLocation();
  const { isConnected, isRegistered, user, walletAddress, connecting, userBalance, connectWallet, signUp, disconnect } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [showSignup, setShowSignup] = useState(false);
  const [username, setUsername] = useState("");
  const [signupError, setSignupError] = useState("");
  const [signing, setSigning] = useState(false);

  const links = [
    { to: "/", label: "Dashboard" },
    { to: "/create", label: "Create Agent" },
    { to: "/deposit", label: "Deposit" },
    { to: "/leaderboard", label: "Leaderboard" },
  ];

  async function handleConnect() {
    try {
      const result = await connectWallet();
      if (!result.registered) {
        setShowSignup(true);
      }
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    setSignupError("");
    const trimmed = username.trim();
    if (trimmed.length < 2) {
      setSignupError("Username must be at least 2 characters");
      return;
    }
    setSigning(true);
    try {
      await signUp(trimmed);
      setShowSignup(false);
      setUsername("");
    } catch (err) {
      setSignupError(err.message);
    } finally {
      setSigning(false);
    }
  }

  function shortAddr(addr) {
    return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";
  }

  return (
    <>
      <nav className="border-b border-dark-600 bg-dark-800/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-accent-green font-bold text-lg font-mono">
              SILICON COLISEUM
            </span>
            <span className="text-xs text-accent-red font-bold bg-accent-red/10 px-1.5 py-0.5 rounded border border-accent-red/20">
              LIVE
            </span>
          </Link>

          <div className="flex items-center gap-1">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  location.pathname === link.to
                    ? "bg-dark-600 text-accent-green"
                    : "text-gray-400 hover:text-gray-200 hover:bg-dark-700"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="px-2 py-1.5 bg-dark-700 border border-dark-600 rounded text-sm text-gray-400 hover:text-white hover:bg-dark-600 transition-colors"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19"}
            </button>
            {!isConnected ? (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="px-4 py-1.5 bg-accent-purple/20 border border-accent-purple/30 rounded text-sm text-purple-300 hover:bg-accent-purple/30 transition-colors font-medium disabled:opacity-50"
              >
                {connecting ? "Connecting..." : "Connect Wallet"}
              </button>
            ) : !isRegistered ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 font-mono">{shortAddr(walletAddress)}</span>
                <button
                  onClick={() => setShowSignup(true)}
                  className="px-4 py-1.5 bg-accent-green/20 border border-accent-green/30 rounded text-sm text-accent-green hover:bg-accent-green/30 transition-colors font-medium"
                >
                  Sign Up
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-accent-green font-medium">{user.username}</span>
                <span className="text-xs text-yellow-400 font-mono bg-yellow-400/10 px-1.5 py-0.5 rounded">
                  ${userBalance.available?.toFixed(0) || "0"}
                </span>
                <span className="text-xs text-gray-500 font-mono">{shortAddr(walletAddress)}</span>
                <button
                  onClick={disconnect}
                  className="px-2 py-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Signup Modal */}
      {showSignup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-dark-800 border border-dark-600 rounded-lg p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-white mb-1">Sign Up</h2>
            <p className="text-gray-500 text-sm mb-4">
              Choose a username and sign with your wallet to verify ownership.
            </p>

            <form onSubmit={handleSignup} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  maxLength={30}
                  className="w-full bg-dark-900 border border-dark-600 rounded px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-accent-green/50"
                  autoFocus
                />
              </div>

              <div className="bg-dark-900 border border-dark-600 rounded p-3">
                <p className="text-xs text-gray-500 mb-1">Connected wallet</p>
                <p className="text-sm text-gray-300 font-mono break-all">{walletAddress}</p>
              </div>

              <p className="text-xs text-gray-500">
                Clicking &quot;Sign &amp; Register&quot; will open MetaMask to sign a confirmation message. No gas fees involved.
              </p>

              {signupError && (
                <p className="text-accent-red text-sm">{signupError}</p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setShowSignup(false); setSignupError(""); }}
                  className="flex-1 py-2.5 border border-dark-600 rounded text-gray-400 hover:bg-dark-700 transition-colors text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={signing || !username.trim()}
                  className="flex-1 py-2.5 bg-accent-green/20 border border-accent-green/30 rounded text-accent-green font-medium hover:bg-accent-green/30 disabled:opacity-50 transition-colors text-sm"
                >
                  {signing ? "Signing..." : "Sign & Register"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
