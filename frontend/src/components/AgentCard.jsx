import { Link } from "react-router-dom";

const RISK_COLORS = {
  conservative: "text-blue-400",
  balanced: "text-yellow-400",
  aggressive: "text-orange-400",
  degen: "text-red-400",
};

export default function AgentCard({ agent }) {
  const pnl = agent.pnl ?? 0;
  const pnlPct = agent.pnl_percent ?? 0;
  const isPositive = pnl >= 0;

  return (
    <Link
      to={`/agent/${agent.id}`}
      className="block bg-dark-800 border border-dark-600 rounded-lg p-4 hover:border-dark-600/80 hover:bg-dark-700 transition-all"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-white">{agent.name}</h3>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-mono ${RISK_COLORS[agent.risk_level]}`}>
              {agent.risk_level.toUpperCase()}
            </span>
            {agent.owner && (
              <span className="text-xs text-gray-500">
                by {agent.owner}
              </span>
            )}
          </div>
        </div>
        <span
          className={`w-2 h-2 rounded-full mt-1 ${
            agent.is_active ? "bg-accent-green animate-pulse-green" : "bg-gray-600"
          }`}
        />
      </div>

      <div className="space-y-1 text-sm">
        <div className="flex justify-between text-gray-400">
          <span>Budget</span>
          <span className="text-gray-200 font-mono">${agent.initial_budget.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-gray-400">
          <span>Balance</span>
          <span className="text-gray-200 font-mono">${agent.current_balance.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-gray-400">
          <span>PnL</span>
          <span
            className={`font-mono font-semibold ${
              isPositive ? "text-accent-green" : "text-accent-red"
            }`}
          >
            {isPositive ? "+" : ""}${pnl.toFixed(2)} ({isPositive ? "+" : ""}{pnlPct.toFixed(1)}%)
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {(agent.tokens || []).map((t) => (
          <span
            key={t}
            className="px-1.5 py-0.5 bg-dark-600 rounded text-xs text-gray-400 font-mono"
          >
            {t}
          </span>
        ))}
      </div>
    </Link>
  );
}
