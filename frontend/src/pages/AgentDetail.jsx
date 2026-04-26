import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getAgent, toggleAgent, deleteAgent, exitAgent, triggerEvaluation } from "../api/client";
import { useAuth } from "../context/AuthContext";
import TradeList from "../components/TradeList";

const RISK_COLORS = {
  conservative: "text-blue-400",
  balanced: "text-yellow-400",
  aggressive: "text-orange-400",
  degen: "text-red-400",
};

export default function AgentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [showDecisions, setShowDecisions] = useState(false);

  useEffect(() => {
    loadAgent();
    const interval = setInterval(loadAgent, 15000);
    return () => clearInterval(interval);
  }, [id]);

  async function loadAgent() {
    try {
      const data = await getAgent(id);
      setAgent(data);
    } catch (err) {
      console.error("Failed to load agent:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle() {
    try {
      await toggleAgent(id, user?.id);
      loadAgent();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this agent and all its trade history?")) return;
    try {
      await deleteAgent(id, user?.id);
      navigate("/");
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleEvaluate() {
    setEvaluating(true);
    try {
      await triggerEvaluation();
      setTimeout(loadAgent, 5000);
    } catch (err) {
      alert(err.message);
    } finally {
      setEvaluating(false);
    }
  }

  async function handleExit() {
    const msg = agent.trading_mode === "paper"
      ? "Liquidate all holdings and close this agent? (Paper mode - no real transfers)"
      : "Sell ALL holdings for USDT and transfer to your wallet? This cannot be undone!";
    if (!confirm(msg)) return;
    setExiting(true);
    try {
      const result = await exitAgent(id, user?.id);
      if (result.isPaper) {
        alert(`Agent exited! Final value: $${result.totalProceeds}`);
      } else {
        alert(`Exit complete! $${result.totalProceeds} USDT sent to ${result.toAddress}\nTx: ${result.txHash}`);
      }
      navigate("/");
    } catch (err) {
      alert(`Exit failed: ${err.message}`);
    } finally {
      setExiting(false);
    }
  }

  if (loading) {
    return <div className="text-gray-500 text-center py-20">Loading...</div>;
  }

  if (!agent) {
    return <div className="text-gray-500 text-center py-20">Agent not found</div>;
  }

  const holdingsValue = agent.holdings_value ?? 0;
  const pnl = agent.pnl ?? 0;
  const pnlPct = agent.pnl_percent ?? 0;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{agent.name}</h1>
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                agent.is_active ? "bg-accent-green animate-pulse-green" : "bg-gray-600"
              }`}
            />
            <span className={`text-sm font-mono ${RISK_COLORS[agent.risk_level]}`}>
              {agent.risk_level.toUpperCase()}
            </span>
            {agent.trading_mode === "paper" ? (
              <span className="px-2 py-0.5 rounded text-xs font-bold bg-cyan-400/15 text-cyan-400 border border-cyan-400/20">
                PAPER
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded text-xs font-bold bg-accent-green/15 text-accent-green border border-accent-green/20 animate-pulse-green">
                LIVE
              </span>
            )}
            {agent.owner && (
              <span className="text-sm text-gray-500">
                by {agent.owner}
              </span>
            )}
          </div>
          {agent.personality && (
            <p className="text-gray-500 text-sm mt-1 max-w-lg">
              {agent.personality}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleEvaluate}
            disabled={evaluating}
            className="px-3 py-1.5 bg-dark-700 border border-dark-600 rounded text-sm text-gray-300 hover:bg-dark-600 disabled:opacity-50"
          >
            {evaluating ? "Running..." : "Evaluate Now"}
          </button>
          {user?.id === agent.user_id && (
            <>
              <button
                onClick={handleToggle}
                className={`px-3 py-1.5 rounded text-sm border ${
                  agent.is_active
                    ? "border-accent-red/30 text-accent-red hover:bg-accent-red/10"
                    : "border-accent-green/30 text-accent-green hover:bg-accent-green/10"
                }`}
              >
                {agent.is_active ? "Pause" : "Activate"}
              </button>
              <button
                onClick={handleExit}
                disabled={exiting}
                className="px-3 py-1.5 rounded text-sm font-medium border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 disabled:opacity-50"
              >
                {exiting ? "Exiting..." : "Exit & Withdraw"}
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 border border-dark-600 rounded text-sm text-gray-500 hover:text-accent-red hover:border-accent-red/30"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Initial Budget" value={`$${agent.initial_budget.toFixed(2)}`} />
        <StatCard label="Cash Balance" value={`$${agent.current_balance.toFixed(2)}`} />
        <StatCard label="Holdings Value" value={`$${holdingsValue.toFixed(2)}`} />
        <StatCard
          label="PnL"
          value={`${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnl >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`}
          color={pnl >= 0 ? "text-accent-green" : "text-accent-red"}
        />
      </div>

      {/* Tokens */}
      <div className="flex gap-2 mb-6">
        {(agent.tokens || []).map((t) => (
          <span
            key={t}
            className="px-2 py-1 bg-dark-800 border border-dark-600 rounded text-sm font-mono text-gray-300"
          >
            {t}
          </span>
        ))}
      </div>

      {/* Holdings */}
      {agent.holdings?.length > 0 && (
        <div className="bg-dark-800 border border-dark-600 rounded-lg p-4 mb-6">
          <h2 className="text-lg font-semibold text-white mb-3">Current Holdings</h2>
          <div className="space-y-2">
            {agent.holdings.map((h) => {
              const tokenPnl = h.pnl_percent ?? 0;
              const profitUsd = h.profit_usd ?? 0;
              return (
                <div
                  key={h.token}
                  className="flex items-center justify-between py-2 border-b border-dark-700 last:border-0"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium text-white">{h.token}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-accent-green/15 text-accent-green font-bold">
                        {h.leverage ?? 4}x LONG
                      </span>
                    </div>
                    <div className={`text-xs font-mono ${tokenPnl >= 0 ? "text-accent-green" : "text-accent-red"}`}>
                      {tokenPnl >= 0 ? "+" : ""}{tokenPnl.toFixed(1)}% ({profitUsd >= 0 ? "+" : ""}${profitUsd.toFixed(2)})
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="text-gray-300 font-mono">
                      ${(h.collateral_usd ?? 0).toFixed(2)} collateral → ${(h.size_usd ?? 0).toFixed(2)} size
                    </div>
                    <div className="text-gray-500">
                      entry ${(h.entry_price ?? 0).toFixed(4)}{h.current_price > 0 ? ` → $${h.current_price.toFixed(4)}` : ""}
                    </div>
                    {h.value > 0 && (
                      <div className="text-gray-400 font-mono text-xs">
                        value ≈ ${h.value.toFixed(2)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Decisions */}
      {agent.recentDecisions?.length > 0 && (
        <div className="bg-dark-800 border border-dark-600 rounded-lg mb-6">
          <button
            onClick={() => setShowDecisions((v) => !v)}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-dark-700/50 transition-colors rounded-lg"
          >
            <h2 className="text-lg font-semibold text-white">
              Recent AI Decisions ({agent.recentDecisions.length})
            </h2>
            <span className={`text-gray-400 transition-transform ${showDecisions ? "rotate-180" : ""}`}>
              &#9660;
            </span>
          </button>
          {showDecisions && <div className="space-y-3 px-4 pb-4">
            {agent.recentDecisions.map((d) => (
              <div key={d.id} className="border-b border-dark-700 pb-3 last:border-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-bold ${
                      d.should_trade
                        ? "bg-accent-green/20 text-accent-green"
                        : "bg-gray-700 text-gray-400"
                    }`}
                  >
                    {d.should_trade ? "TRADE" : "HOLD"}
                  </span>
                  {d.raw_json?.actions?.length > 0 && (
                    <span className="text-xs text-gray-500 font-mono">
                      {d.raw_json.actions.length} action{d.raw_json.actions.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  <span className="text-xs text-gray-500">
                    {new Date(d.created_at + "Z").toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-gray-300">{d.reasoning}</p>
                {d.market_analysis && (
                  <p className="text-xs text-gray-500 mt-1">{d.market_analysis}</p>
                )}
                {d.raw_json?.actions?.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {d.raw_json.actions.map((a, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 bg-dark-900 rounded px-2.5 py-1.5 text-xs"
                      >
                        <span
                          className={`px-1.5 py-0.5 rounded font-bold ${
                            a.action === "BUY"
                              ? "bg-accent-green/20 text-accent-green"
                              : "bg-accent-red/20 text-accent-red"
                          }`}
                        >
                          {a.action}
                        </span>
                        <span className="text-white font-mono">{a.token}</span>
                        <span className="text-gray-400 font-mono">${a.amount_usd}</span>
                        {a.confidence != null && (
                          <span className="text-gray-500">{(a.confidence * 100).toFixed(0)}%</span>
                        )}
                        {a.reason && (
                          <span className="text-gray-500 truncate max-w-xs">{a.reason}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>}
        </div>
      )}

      {/* Trade History */}
      <div className="bg-dark-800 border border-dark-600 rounded-lg p-4">
        <h2 className="text-lg font-semibold text-white mb-3">Trade History</h2>
        <TradeList trades={agent.recentTrades} />
      </div>
    </div>
  );
}

function StatCard({ label, value, color = "text-white" }) {
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-lg p-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-lg font-mono font-semibold ${color}`}>{value}</div>
    </div>
  );
}
