const API_BASE = import.meta.env.VITE_API_URL || "/api";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// Auth
export const checkWallet = (wallet_address) =>
  request("/auth/check", { method: "POST", body: JSON.stringify({ wallet_address }) });
export const signup = (data) =>
  request("/auth/signup", { method: "POST", body: JSON.stringify(data) });

// Tokens
export const getTokens = () => request("/tokens");
export const getTradeableTokens = () => request("/tokens/tradeable");
export const getTokenPrices = () => request("/tokens/prices");
export const getTokenCategories = () => request("/tokens/categories");

// Agents
export const getAgents = (userId) =>
  request(userId ? `/agents?user_id=${userId}` : "/agents");
export const getAgent = (id) => request(`/agents/${id}`);
export const createAgent = (data) =>
  request("/agents", { method: "POST", body: JSON.stringify(data) });
export const toggleAgent = (id, user_id) =>
  request(`/agents/${id}/toggle`, { method: "PATCH", body: JSON.stringify({ user_id }) });
export const deleteAgent = (id, user_id) =>
  request(`/agents/${id}`, { method: "DELETE", body: JSON.stringify({ user_id }) });
export const exitAgent = (id, user_id) =>
  request(`/agents/${id}/exit`, { method: "POST", body: JSON.stringify({ user_id }) });

// Trades
export const getAgentTrades = (agentId, limit = 50) =>
  request(`/trades/${agentId}?limit=${limit}`);

// Leaderboard
export const getLeaderboard = () => request("/leaderboard");

// Wallet & Deposits
export const getWalletInfo = () => request("/wallet/info");
export const getUserBalance = (userId) => request(`/wallet/balance/${userId}`);
export const confirmDeposit = (user_id, tx_hash) =>
  request("/wallet/confirm-deposit", { method: "POST", body: JSON.stringify({ user_id, tx_hash }) });
export const getUserDeposits = (userId) => request(`/wallet/deposits/${userId}`);

// Manual trigger
export const triggerEvaluation = () =>
  request("/evaluate", { method: "POST" });
