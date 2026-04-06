export default function TradeList({ trades }) {
  if (!trades?.length) {
    return (
      <p className="text-gray-500 text-sm text-center py-8">
        No trades yet. Wait for the next evaluation cycle.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-500 text-xs uppercase border-b border-dark-600">
            <th className="text-left py-2 px-2">Time</th>
            <th className="text-left py-2 px-2">Action</th>
            <th className="text-left py-2 px-2">Token</th>
            <th className="text-right py-2 px-2">Amount</th>
            <th className="text-right py-2 px-2">Price</th>
            <th className="text-right py-2 px-2">Confidence</th>
            <th className="text-left py-2 px-2">Status</th>
            <th className="text-left py-2 px-2">Tx</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr
              key={trade.id}
              className="border-b border-dark-700 hover:bg-dark-700/50"
            >
              <td className="py-2 px-2 text-gray-400 font-mono text-xs">
                {new Date(trade.created_at + "Z").toLocaleString()}
              </td>
              <td className="py-2 px-2">
                <span
                  className={`px-2 py-0.5 rounded text-xs font-bold ${
                    trade.action === "BUY"
                      ? "bg-accent-green/20 text-accent-green"
                      : "bg-accent-red/20 text-accent-red"
                  }`}
                >
                  {trade.action}
                </span>
              </td>
              <td className="py-2 px-2 font-mono font-medium text-white">
                {trade.token}
              </td>
              <td className="py-2 px-2 text-right font-mono text-gray-200">
                ${trade.amount_usd?.toFixed(2)}
              </td>
              <td className="py-2 px-2 text-right font-mono text-gray-400">
                ${trade.price}
              </td>
              <td className="py-2 px-2 text-right font-mono">
                <span
                  className={
                    trade.confidence >= 0.7
                      ? "text-accent-green"
                      : trade.confidence >= 0.4
                      ? "text-yellow-400"
                      : "text-gray-400"
                  }
                >
                  {((trade.confidence || 0) * 100).toFixed(0)}%
                </span>
              </td>
              <td className="py-2 px-2">
                <span
                  className={`text-xs font-mono ${
                    trade.status === "completed"
                      ? "text-accent-green"
                      : trade.status === "failed"
                      ? "text-accent-red"
                      : "text-yellow-400"
                  }`}
                >
                  {trade.status || "completed"}
                </span>
              </td>
              <td className="py-2 px-2">
                {trade.tx_hash ? (
                  <a
                    href={`https://arbiscan.io/tx/${trade.tx_hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:underline font-mono"
                    title={trade.tx_hash}
                  >
                    {trade.tx_hash.slice(0, 8)}...
                  </a>
                ) : (
                  <span className="text-xs text-gray-600">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
