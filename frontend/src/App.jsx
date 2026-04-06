import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import Navbar from "./components/Navbar";
import Dashboard from "./pages/Dashboard";
import CreateAgent from "./pages/CreateAgent";
import AgentDetail from "./pages/AgentDetail";
import Leaderboard from "./pages/Leaderboard";
import Deposit from "./pages/BuyTokens";

export default function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <div className="min-h-screen bg-dark-900">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/create" element={<CreateAgent />} />
            <Route path="/agent/:id" element={<AgentDetail />} />
            <Route path="/deposit" element={<Deposit />} />
            <Route path="/buy-tokens" element={<Navigate to="/deposit" />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </AuthProvider>
    </ThemeProvider>
  );
}
