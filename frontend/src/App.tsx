import { useCallback, useEffect, useRef, useState } from "react";

import { storageApi } from "./api/storageApi";
import { DashboardCards } from "./components/dashboard/DashboardCards";
import { FileExplorer } from "./components/explorer/FileExplorer";

type ToastTone = "info" | "success" | "warning" | "error";

type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
};

type DashboardMetric = {
  label: string;
  value: string;
  detail: string;
  tone: "blue" | "purple" | "green" | "neutral" | "orange" | "red" | "teal";
  icon: string;
};

type SystemStats = {
  total_storage: string | null;
  used_storage: string | null;
  available_storage: string | null;
  storage_usage_percentage: number | null;
  cpu_usage_percentage: number | null;
  ram_usage_percentage: number | null;
  uptime: string | null;
};

const DASHBOARD_STORAGE_KEY = "pi-storage-manager-dashboard-mode";
const BACKEND_STATUS_KEY = "pi-storage-manager-backend-check";

function getInitialDashboardMode(): "expanded" | "collapsed" | "hidden" {
  if (typeof window === "undefined") {
    return "expanded";
  }

  const savedMode = window.sessionStorage.getItem(DASHBOARD_STORAGE_KEY);
  if (savedMode === "collapsed" || savedMode === "hidden" || savedMode === "expanded") {
    return savedMode;
  }

  return "expanded";
}

export default function App() {
  const [dashboardMode, setDashboardMode] = useState<"expanded" | "collapsed" | "hidden">(
    getInitialDashboardMode,
  );
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isStatsLoading, setIsStatsLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [systemStats, setSystemStats] = useState<SystemStats>({
    total_storage: null,
    used_storage: null,
    available_storage: null,
    storage_usage_percentage: null,
    cpu_usage_percentage: null,
    ram_usage_percentage: null,
    uptime: null,
  });
  const backendCheckDoneRef = useRef(false);

  const pushToast = useCallback((message: string, tone: ToastTone = "info") => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((currentToasts) => [...currentToasts, { id, message, tone }]);

    window.setTimeout(() => {
      setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id));
    }, 3200);
  }, []);

  const setAndStoreDashboardMode = useCallback((mode: "expanded" | "collapsed" | "hidden") => {
    setDashboardMode(mode);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(DASHBOARD_STORAGE_KEY, mode);
    }
  }, []);

  const applySystemStats = useCallback((stats: SystemStats) => {
    setSystemStats({
      total_storage: stats.total_storage ?? null,
      used_storage: stats.used_storage ?? null,
      available_storage: stats.available_storage ?? null,
      storage_usage_percentage: stats.storage_usage_percentage ?? null,
      cpu_usage_percentage: stats.cpu_usage_percentage ?? null,
      ram_usage_percentage: stats.ram_usage_percentage ?? null,
      uptime: stats.uptime ?? null,
    });
  }, []);

  useEffect(() => {
    if (backendCheckDoneRef.current) {
      return;
    }
    backendCheckDoneRef.current = true;

    async function loadBackendStatus() {
      const hasCheckedBackend =
        typeof window !== "undefined" && window.sessionStorage.getItem(BACKEND_STATUS_KEY) === "done";

      try {
        await storageApi.health();
        const stats = await storageApi.systemStats();
        applySystemStats(stats);
        setDashboardError(null);

        if (!hasCheckedBackend) {
          pushToast("Backend connection established.", "success");
        }
      } catch {
        setDashboardError("Unable to load system statistics.");
        if (!hasCheckedBackend) {
          pushToast("Unable to load system statistics.", "warning");
        }
      } finally {
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(BACKEND_STATUS_KEY, "done");
        }
        setIsStatsLoading(false);
      }
    }

    void loadBackendStatus();
  }, [applySystemStats, pushToast]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (dashboardMode === "hidden") {
        return;
      }
      try {
        const stats = await storageApi.systemStats();
        applySystemStats(stats);
        setDashboardError(null);
      } catch {
        setDashboardError("Unable to load system statistics.");
      } finally {
        setIsStatsLoading(false);
      }
    }, 10000);

    return () => window.clearInterval(timer);
  }, [applySystemStats, dashboardMode]);

  const dashboardMetrics: DashboardMetric[] = [
    {
      label: "Total Storage",
      value: systemStats.total_storage ?? "—",
      detail: "Total Capacity",
      tone: "blue",
      icon: "💽",
    },
    {
      label: "Used Storage",
      value: systemStats.used_storage ?? "—",
      detail: "Used",
      tone: "purple",
      icon: "👜",
    },
    {
      label: "Available Storage",
      value: systemStats.available_storage ?? "—",
      detail: "Available",
      tone: "green",
      icon: "🗃",
    },
    {
      label: "CPU Usage",
      value: systemStats.cpu_usage_percentage == null ? "—" : `${Math.round(systemStats.cpu_usage_percentage)}%`,
      detail: "Current load",
      tone: "orange",
      icon: "⚙",
    },
    {
      label: "RAM Usage",
      value: systemStats.ram_usage_percentage == null ? "—" : `${Math.round(systemStats.ram_usage_percentage)}%`,
      detail: "Current memory use",
      tone: "red",
      icon: "▣",
    },
  ];

  return (
    <div className="app-layout">
      <main className="app-shell">
        <section className="workspace">
          <header className="app-main-header">
            <h1>Pi Storage Manager</h1>
            <p>Your Personal File Manager</p>
          </header>

          <DashboardCards
            metrics={dashboardMetrics}
            mode={dashboardMode}
            isLoading={isStatsLoading}
            errorMessage={dashboardError}
            onModeChange={setAndStoreDashboardMode}
          />

          <FileExplorer onNotify={pushToast} />
        </section>

        <div className="toast-stack" aria-live="polite" aria-atomic="true">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.tone}`}>
              {toast.message}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
