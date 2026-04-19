import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { getTradeableTokens, createAgent, getAgents } from "../api/client";
import { useAuth } from "../context/AuthContext";

const RISK_OPTIONS = [
  {
    value: "conservative",
    label: "Conservative",
    desc: "High-confidence trades only, small positions",
    color: "text-blue-400 border-blue-400/30",
  },
  {
    value: "balanced",
    label: "Balanced",
    desc: "Medium+ confidence, moderate positions",
    color: "text-yellow-400 border-yellow-400/30",
  },
  {
    value: "aggressive",
    label: "Aggressive",
    desc: "Lower confidence OK, larger positions",
    color: "text-orange-400 border-orange-400/30",
  },
  {
    value: "degen",
    label: "Degen",
    desc: "Chase pumps, max volatility, YOLO",
    color: "text-red-400 border-red-400/30",
  },
];

const CATEGORY_LABELS = {
  major: "Major",
  defi: "DeFi Blue Chip",
  "arb-defi": "Arbitrum DeFi",
  gaming: "Gaming",
  infra: "Infrastructure",
  meme: "Meme",
  lsd: "Liquid Staking",
};

export default function CreateAgent() {
  const navigate = useNavigate();
  const { user, isRegistered, isConnected, walletAddress, userBalance, connectWallet, signUp, connecting, refreshBalance } = useAuth();
  const [showSignup, setShowSignup] = useState(false);
  const [username, setUsername] = useState("");
  const [signupError, setSignupError] = useState("");
  const [signing, setSigning] = useState(false);
  const [tokens, setTokens] = useState([]);
  const [form, setForm] = useState({
    name: "",
    risk_level: "balanced",
    trading_mode: "paper",
    budget: 100,
    tokens: [],
    personality: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    getTradeableTokens().then(setTokens).catch(console.error);
  }, []);

  function toggleToken(symbol) {
    setForm((prev) => ({
      ...prev,
      tokens: prev.tokens.includes(symbol)
        ? prev.tokens.filter((t) => t !== symbol)
        : [...prev.tokens, symbol],
    }));
  }

  function selectCategory(category) {
    const catTokens = tokens.filter((t) => t.category === category).map((t) => t.symbol);
    const allSelected = catTokens.every((s) => form.tokens.includes(s));
    if (allSelected) {
      setForm((prev) => ({
        ...prev,
        tokens: prev.tokens.filter((t) => !catTokens.includes(t)),
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        tokens: [...new Set([...prev.tokens, ...catTokens])],
      }));
    }
  }

  function selectAll() {
    if (form.tokens.length === tokens.length) {
      setForm((prev) => ({ ...prev, tokens: [] }));
    } else {
      setForm((prev) => ({ ...prev, tokens: tokens.map((t) => t.symbol) }));
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!form.name.trim()) return setError("Name is required");
    if (!form.tokens.length) return setError("Select at least one token");
    if (form.budget < 1) return setError("Minimum budget is $1");
    if (form.trading_mode === "live" && form.budget > userBalance.available) {
      return setError(`Budget exceeds available balance ($${userBalance.available.toFixed(2)}). Deposit more USDT.`);
    }

    setSubmitting(true);
    try {
      const agent = await createAgent({ ...form, user_id: user.id });
      await refreshBalance();
      navigate(`/agent/${agent.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConnect() {
    try {
      const result = await connectWallet();
      if (!result.registered) setShowSignup(true);
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    setSignupError("");
    const trimmed = username.trim();
    if (trimmed.length < 2) { setSignupError("Username must be at least 2 characters"); return; }
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

  if (!isRegistered) {
    return (
      <>
        <div className="text-center py-20 bg-dark-800 rounded-lg border border-dark-600 max-w-2xl mx-auto">
          <p className="text-gray-400 text-lg mb-2">Authentication Required</p>
          <p className="text-gray-600 text-sm mb-6">
            Connect your wallet and sign up to create an AI trading agent.
          </p>
          {!isConnected ? (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="px-6 py-2.5 bg-accent-purple/20 border border-accent-purple/30 rounded text-purple-300 hover:bg-accent-purple/30 transition-colors font-medium disabled:opacity-50"
            >
              {connecting ? "Connecting..." : "Connect Wallet"}
            </button>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <span className="text-xs text-gray-500 font-mono">{walletAddress}</span>
              <button
                onClick={() => setShowSignup(true)}
                className="px-6 py-2.5 bg-accent-green/20 border border-accent-green/30 rounded text-accent-green hover:bg-accent-green/30 transition-colors font-medium"
              >
                Sign Up
              </button>
            </div>
          )}
        </div>

        {showSignup && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-dark-800 border border-dark-600 rounded-lg p-6 w-full max-w-md mx-4">
              <h2 className="text-xl font-bold text-white mb-1">Sign Up</h2>
              <p className="text-gray-500 text-sm mb-4">
                Choose a username and sign with your wallet to verify ownership.
              </p>
              <form onSubmit={handleSignup} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Username</label>
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
                {signupError && <p className="text-accent-red text-sm">{signupError}</p>}
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

  {/* Removed deposit-required gate — paper trading doesn't need funds */}

  // Group tokens by category
  const groupedTokens = {};
  for (const token of tokens) {
    if (!groupedTokens[token.category]) groupedTokens[token.category] = [];
    groupedTokens[token.category].push(token);
  }

  const filteredTokens = searchQuery
    ? tokens.filter(
        (t) =>
          t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : null;

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-2">Create AI Agent</h1>
      <p className="text-gray-500 text-sm mb-6">
        Available balance: <span className="text-accent-green font-mono">${userBalance.available.toFixed(2)}</span>
        {" "}&middot; Trades execute via Odos Router on Arbitrum One
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Agent Name
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Moon Hunter, Dip Buyer, Diamond Hands..."
            className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-accent-green/50"
          />
        </div>

        {/* Risk Level */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Risk Level
          </label>
          <div className="grid grid-cols-2 gap-2">
            {RISK_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setForm({ ...form, risk_level: opt.value })}
                className={`p-3 rounded border text-left transition-all ${
                  form.risk_level === opt.value
                    ? `${opt.color} bg-dark-700`
                    : "border-dark-600 text-gray-400 hover:border-dark-500"
                }`}
              >
                <div className="font-medium text-sm">{opt.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Trading Mode */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Trading Mode
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setForm({ ...form, trading_mode: "paper" })}
              className={`p-3 rounded border text-left transition-all ${
                form.trading_mode === "paper"
                  ? "text-cyan-400 border-cyan-400/30 bg-dark-700"
                  : "border-dark-600 text-gray-400 hover:border-dark-500"
              }`}
            >
              <div className="font-medium text-sm">Paper Trading</div>
              <div className="text-xs text-gray-500 mt-0.5">Test strategy with simulated trades</div>
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, trading_mode: "live" })}
              className={`p-3 rounded border text-left transition-all ${
                form.trading_mode === "live"
                  ? "text-red-400 border-red-400/30 bg-dark-700"
                  : "border-dark-600 text-gray-400 hover:border-dark-500"
              }`}
            >
              <div className="font-medium text-sm">Live Trading</div>
              <div className="text-xs text-gray-500 mt-0.5">Real USDT trades on Arbitrum One</div>
            </button>
          </div>
        </div>

        {/* Budget */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Budget (USDT)
          </label>
          <input
            type="number"
            value={form.budget}
            onChange={(e) =>
              setForm({ ...form, budget: parseFloat(e.target.value) || 0 })
            }
            min={1}
            max={form.trading_mode === "paper" ? 100000 : userBalance.available}
            step={1}
            className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-white font-mono focus:outline-none focus:border-accent-green/50"
          />
          <p className="text-xs text-gray-600 mt-1">
            {form.trading_mode === "paper"
              ? "Virtual budget for simulated trades"
              : `Real USDT from your deposited balance (max $${userBalance.available.toFixed(2)})`}
          </p>
        </div>

        {/* Token Selection */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-300">
              Tokens to Trade ({form.tokens.length} selected)
            </label>
            <button
              type="button"
              onClick={selectAll}
              className="text-xs text-accent-green hover:underline"
            >
              {form.tokens.length === tokens.length ? "Deselect All" : "Select All"}
            </button>
          </div>

          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tokens..."
            className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-accent-green/50 text-sm mb-3"
          />

          {/* Filtered results */}
          {filteredTokens ? (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 mb-3">
              {filteredTokens.map((token) => (
                <button
                  key={token.symbol}
                  type="button"
                  onClick={() => toggleToken(token.symbol)}
                  className={`px-2 py-1.5 rounded border text-xs font-mono transition-all ${
                    form.tokens.includes(token.symbol)
                      ? "border-accent-green/50 bg-accent-green/10 text-accent-green"
                      : "border-dark-600 text-gray-400 hover:border-dark-500"
                  }`}
                  title={token.name}
                >
                  {token.symbol}
                </button>
              ))}
              {filteredTokens.length === 0 && (
                <p className="col-span-full text-gray-500 text-sm text-center py-2">No tokens match</p>
              )}
            </div>
          ) : (
            /* Grouped by category */
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {Object.entries(CATEGORY_LABELS).map(([cat, label]) => {
                const catTokens = groupedTokens[cat];
                if (!catTokens?.length) return null;
                const allSelected = catTokens.every((t) => form.tokens.includes(t.symbol));
                return (
                  <div key={cat}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
                      <button
                        type="button"
                        onClick={() => selectCategory(cat)}
                        className="text-xs text-gray-500 hover:text-accent-green"
                      >
                        {allSelected ? "deselect" : "select all"}
                      </button>
                    </div>
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                      {catTokens.map((token) => (
                        <button
                          key={token.symbol}
                          type="button"
                          onClick={() => toggleToken(token.symbol)}
                          className={`px-2 py-1.5 rounded border text-xs font-mono transition-all ${
                            form.tokens.includes(token.symbol)
                              ? "border-accent-green/50 bg-accent-green/10 text-accent-green"
                              : "border-dark-600 text-gray-400 hover:border-dark-500"
                          }`}
                          title={token.name}
                        >
                          {token.symbol}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Personality */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Agent Personality (optional)
          </label>
          <textarea
            value={form.personality}
            onChange={(e) => setForm({ ...form, personality: e.target.value })}
            placeholder="e.g. Focus on momentum plays. Always take profits at 30%+ gains. Avoid tokens with less than $100K liquidity..."
            rows={3}
            className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-accent-green/50 text-sm"
          />
          <p className="text-xs text-gray-600 mt-1">
            Custom instructions that shape how the AI makes trading decisions
          </p>
        </div>

        {error && (
          <p className="text-accent-red text-sm">{error}</p>
        )}

        {form.trading_mode === "live" ? (
          <div className="bg-dark-800 border border-accent-red/20 rounded p-3 text-xs text-gray-500">
            <p className="text-accent-red font-medium mb-1">WARNING: Real Money Trading</p>
            <p>This agent will execute REAL trades using your deposited USDT on Arbitrum One. Trading involves risk of loss.</p>
          </div>
        ) : (
          <div className="bg-dark-800 border border-cyan-400/20 rounded p-3 text-xs text-gray-500">
            <p className="text-cyan-400 font-medium mb-1">Paper Trading Mode</p>
            <p>This agent will simulate trades using virtual funds. No real transactions will be made.</p>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className={`w-full py-3 rounded font-medium disabled:opacity-50 transition-colors ${
            form.trading_mode === "paper"
              ? "bg-cyan-500/20 border border-cyan-400/30 text-cyan-400 hover:bg-cyan-500/30"
              : "bg-accent-green/20 border border-accent-green/30 text-accent-green hover:bg-accent-green/30"
          }`}
        >
          {submitting ? "Creating..." : form.trading_mode === "paper" ? "Deploy Agent (Paper Trading)" : "Deploy Agent (Live Trading)"}
        </button>
      </form>
    </div>
  );
}
