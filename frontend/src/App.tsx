import { useCallback, useEffect, useRef, useState } from "react";

import { storageApi } from "./api/storageApi";
import { DashboardCards } from "./components/dashboard/DashboardCards";
import { FileExplorer } from "./components/explorer/FileExplorer";
import type { SystemStatsResponse } from "./types/api";

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
  variant?: "storage" | "gauge";
  percent?: number;
  subLabel?: string;
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
  const [dashboardMode, setDashboardMode] = useState<"expanded" | "collapsed" | "hidden">(getInitialDashboardMode);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isStatsLoading, setIsStatsLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [systemStats, setSystemStats] = useState<SystemStatsResponse>({
    success: true,
    message: "",
    storage_root: { used_gb: null, file_count: null, folder_count: null },
    volume: { total_gb: null, used_gb: null, available_gb: null, usage_percentage: null },
    storage_root_used_gb: null,
    storage_root_file_count: null,
    storage_root_folder_count: null,
    volume_total_gb: null,
    volume_used_gb: null,
    volume_available_gb: null,
    volume_usage_percentage: null,
    total_storage_gb: null,
    used_storage_gb: null,
    available_storage_gb: null,
    total_storage: null,
    used_storage: null,
    available_storage: null,
    storage_usage_percentage: null,
    cpu_usage_percentage: null,
    ram_usage_percentage: null,
    uptime: null,
  });
  const [isSystemOnline, setIsSystemOnline] = useState<boolean | null>(null);

  const hasInitializedRef = useRef(false);
  const statsRequestInFlightRef = useRef(false);
  const queuedRefreshRef = useRef(false);
  const refreshTimerRef = useRef<number | null>(null);

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

  const fetchSystemStats = useCallback(async (): Promise<boolean> => {
    if (statsRequestInFlightRef.current) {
      queuedRefreshRef.current = true;
      return false;
    }

    statsRequestInFlightRef.current = true;
    try {
      const stats = await storageApi.systemStats();
      setSystemStats(stats);
      setDashboardError(null);
      setIsSystemOnline(true);
      return true;
    } catch {
      setDashboardError("Unable to load system statistics.");
      setIsSystemOnline(false);
      return false;
    } finally {
      setIsStatsLoading(false);
      statsRequestInFlightRef.current = false;
      if (queuedRefreshRef.current) {
        queuedRefreshRef.current = false;
        void fetchSystemStats();
      }
    }
  }, []);

  const refreshSystemStats = useCallback(
    (immediate = false) => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(
        () => {
          refreshTimerRef.current = null;
          void fetchSystemStats();
        },
        immediate ? 0 : 350,
      );
    },
    [fetchSystemStats],
  );

  useEffect(() => {
    if (hasInitializedRef.current) {
      return;
    }
    hasInitializedRef.current = true;

    const hasCheckedBackend =
      typeof window !== "undefined" && window.sessionStorage.getItem(BACKEND_STATUS_KEY) === "done";

    async function initializeSystemStats() {
      const isConnected = await fetchSystemStats();
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(BACKEND_STATUS_KEY, "done");
      }
      if (!hasCheckedBackend) {
        if (!isConnected) {
          pushToast("Unable to load system statistics.", "warning");
        } else {
          pushToast("Backend connection established.", "success");
        }
      }
    }

    void initializeSystemStats();
  }, [fetchSystemStats, pushToast]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (dashboardMode === "hidden") {
        return;
      }
      refreshSystemStats(true);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [dashboardMode, refreshSystemStats]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    },
    [],
  );

  const formatStorageGb = (value: number | string | null) => {
    if (value == null || value === "") {
      return "—";
    }

    if (typeof value === "number") {
      return `${value.toFixed(1)} GB`;
    }

    if (value.endsWith("GB") || value.endsWith("MB") || value.endsWith("TB")) {
      return value;
    }

    return `${Number(value).toFixed(1)} GB`;
  };

  const storageRootUsedValue =
    systemStats.storage_root?.used_gb ?? systemStats.storage_root_used_gb ?? Number.parseFloat(systemStats.used_storage ?? "0");
  const volumeTotalValue =
    systemStats.volume?.total_gb ?? systemStats.volume_total_gb ?? Number.parseFloat(systemStats.total_storage ?? "0");
  const volumeUsedValue =
    systemStats.volume?.used_gb ?? systemStats.volume_used_gb ?? Number.parseFloat(systemStats.used_storage ?? "0");
  const volumeAvailableValue =
    systemStats.volume?.available_gb ?? systemStats.volume_available_gb ?? Number.parseFloat(systemStats.available_storage ?? "0");
  const volumePercent =
    systemStats.volume?.usage_percentage ?? systemStats.volume_usage_percentage ?? systemStats.storage_usage_percentage ?? 0;

  const rootPercent = volumeTotalValue > 0 ? Math.max(0, Math.min(100, (storageRootUsedValue / volumeTotalValue) * 100)) : 0;
  const cpuPercent = systemStats.cpu_usage_percentage == null ? 0 : Math.max(0, Math.min(100, systemStats.cpu_usage_percentage));
  const ramPercent = systemStats.ram_usage_percentage == null ? 0 : Math.max(0, Math.min(100, systemStats.ram_usage_percentage));

  const dashboardMetrics: DashboardMetric[] = [
    {
      label: "Storage Root",
      value: formatStorageGb(storageRootUsedValue),
      detail: `Volume ${formatStorageGb(volumeTotalValue)} total • ${Math.round(volumePercent)}% used`,
      tone: "orange",
      icon: "◧",
      variant: "storage",
      percent: rootPercent,
      subLabel: `Used ${formatStorageGb(volumeUsedValue)} • Available ${formatStorageGb(volumeAvailableValue)}`,
    },
    {
      label: "CPU",
      value: systemStats.cpu_usage_percentage == null ? "—" : `${Math.round(systemStats.cpu_usage_percentage)}%`,
      detail: "Current load",
      tone: "green",
      icon: "◔",
      variant: "gauge",
      percent: cpuPercent,
      subLabel: "Load",
    },
    {
      label: "RAM",
      value: systemStats.ram_usage_percentage == null ? "—" : `${Math.round(systemStats.ram_usage_percentage)}%`,
      detail: "Current memory",
      tone: "red",
      icon: "◔",
      variant: "gauge",
      percent: ramPercent,
      subLabel: "Memory",
    },
  ];

  return (
    <div className="app-layout">
      <main className="app-shell">
        <section className="workspace">
          <header className="app-main-header">
            <div className="app-main-brand">
              <span className="app-main-brand-icon" aria-hidden="true">
                🗂
              </span>
              <div>
                <h1>Pi Storage Manager</h1>
                <p>Personal File Manager</p>
              </div>
            </div>
            <div className="app-system-status" role="status" aria-live="polite">
              <span
                className={`app-system-status-dot ${
                  isSystemOnline == null
                    ? "app-system-status-dot-pending"
                    : isSystemOnline
                      ? "app-system-status-dot-online"
                      : "app-system-status-dot-offline"
                }`}
                aria-hidden="true"
              />
              <span>
                {isSystemOnline == null
                  ? "Checking system status..."
                  : isSystemOnline
                    ? "System Online"
                    : "System metrics unavailable"}
              </span>
            </div>
          </header>

          <DashboardCards
            metrics={dashboardMetrics}
            mode={dashboardMode}
            isLoading={isStatsLoading}
            errorMessage={dashboardError}
            onModeChange={setAndStoreDashboardMode}
          />

          <FileExplorer onNotify={pushToast} onFilesystemMutationComplete={() => refreshSystemStats()} />
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
