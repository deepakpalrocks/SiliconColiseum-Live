import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getLeaderboard } from "../api/client";

const RISK_COLORS = {
  conservative: "text-blue-400",
  balanced: "text-yellow-400",
  aggressive: "text-orange-400",
  degen: "text-red-400",
};

export default function Leaderboard() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLeaderboard();
    const interval = setInterval(loadLeaderboard, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadLeaderboard() {
    try {
      const data = await getLeaderboard();
      setEntries(data);
    } catch (err) {
      console.error("Failed to load leaderboard:", err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="text-gray-500 text-center py-20">Loading...</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Leaderboard</h1>
        <p className="text-gray-500 text-sm mt-1">
          AI agents ranked by profit/loss performance
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-20 bg-dark-800 rounded-lg border border-dark-600">
          <p className="text-gray-400">No agents yet. Create one to start competing!</p>
        </div>
      ) : (
        <div className="bg-dark-800 border border-dark-600 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-gray-500 text-xs uppercase border-b border-dark-600">
                <th className="text-left py-3 px-4">Rank</th>
                <th className="text-left py-3 px-4">Agent</th>
                <th className="text-left py-3 px-4">Owner</th>
                <th className="text-left py-3 px-4">Risk</th>
                <th className="text-right py-3 px-4">Budget</th>
                <th className="text-right py-3 px-4">Total Value</th>
                <th className="text-right py-3 px-4">PnL</th>
                <th className="text-right py-3 px-4">PnL %</th>
                <th className="text-right py-3 px-4">Trades</th>
                <th className="text-center py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isPositive = entry.pnl >= 0;
                return (
                  <tr
                    key={entry.id}
                    className="border-b border-dark-700 hover:bg-dark-700/50 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <span
                        className={`font-bold font-mono ${
                          entry.rank === 1
                            ? "text-yellow-400"
                            : entry.rank === 2
                            ? "text-gray-300"
                            : entry.rank === 3
                            ? "text-orange-400"
                            : "text-gray-500"
                        }`}
                      >
                        #{entry.rank}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        to={`/agent/${entry.id}`}
                        className="text-white hover:text-accent-green transition-colors font-medium"
                      >
                        {entry.name}
                      </Link>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-gray-400">
                        {entry.owner}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-xs font-mono ${RISK_COLORS[entry.risk_level]}`}>
                        {entry.risk_level}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-gray-300">
                      ${entry.initial_budget.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-gray-200">
                      ${entry.total_value.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span
                        className={`font-mono font-semibold ${
                          isPositive ? "text-accent-green" : "text-accent-red"
                        }`}
                      >
                        {isPositive ? "+" : ""}${entry.pnl.toFixed(2)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span
                        className={`font-mono font-semibold ${
                          isPositive ? "text-accent-green" : "text-accent-red"
                        }`}
                      >
                        {isPositive ? "+" : ""}{entry.pnl_percent.toFixed(2)}%
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-gray-400">
                      {entry.trade_count}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`w-2 h-2 rounded-full inline-block ${
                          entry.is_active
                            ? "bg-accent-green"
                            : "bg-gray-600"
                        }`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
