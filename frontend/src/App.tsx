import { useEffect, useState } from "react";

import { storageApi } from "./api/storageApi";
import { DashboardCards } from "./components/dashboard/DashboardCards";
import { FileExplorer } from "./components/explorer/FileExplorer";

export default function App() {
  const [statusMessage, setStatusMessage] = useState("Connecting to backend...");

  useEffect(() => {
    async function loadPlaceholders() {
      try {
        const [health, stats] = await Promise.all([storageApi.health(), storageApi.systemStats()]);
        setStatusMessage(`${health.message} | ${stats.message}`);
      } catch {
        setStatusMessage("Backend is not reachable. Start FastAPI to test integration.");
      }
    }

    void loadPlaceholders();
  }, []);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>Pi Storage Manager</h1>
          <p>Phase 1: Initial project skeleton for frontend/backend integration.</p>
        </div>
        <span className="status-chip">{statusMessage}</span>
      </header>

      <DashboardCards />
      <FileExplorer />
    </main>
  );
}

