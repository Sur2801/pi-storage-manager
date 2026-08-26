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

type SidebarLink = {
  label: string;
  icon: string;
  active?: boolean;
};

const DASHBOARD_STORAGE_KEY = "pi-storage-manager-dashboard-mode";
const BACKEND_STATUS_KEY = "pi-storage-manager-backend-check";

const primaryLinks: SidebarLink[] = [
  { label: "Explorer", icon: "🗂", active: true },
  { label: "Recent", icon: "🕘" },
  { label: "Favorites", icon: "☆" },
  { label: "Shared", icon: "⇄" },
  { label: "Trash", icon: "🗑" },
];

const shortcuts: SidebarLink[] = [
  { label: "Documents", icon: "📁" },
  { label: "Photos", icon: "🖼" },
  { label: "Videos", icon: "🎞" },
  { label: "Music", icon: "🎵" },
  { label: "Downloads", icon: "⤓" },
  { label: "Backups", icon: "☁" },
];

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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Connecting to backend...");
  const [toasts, setToasts] = useState<Toast[]>([]);
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

  useEffect(() => {
    const hasCheckedBackend = typeof window !== "undefined" && window.sessionStorage.getItem(BACKEND_STATUS_KEY) === "done";
    if (backendCheckDoneRef.current || hasCheckedBackend) {
      return;
    }
    backendCheckDoneRef.current = true;

    async function loadBackendStatus() {
      try {
        await storageApi.health();
        const stats = await storageApi.systemStats();
        setSystemStats({
          total_storage: stats.total_storage ?? null,
          used_storage: stats.used_storage ?? null,
          available_storage: stats.available_storage ?? null,
          storage_usage_percentage: stats.storage_usage_percentage ?? null,
          cpu_usage_percentage: stats.cpu_usage_percentage ?? null,
          ram_usage_percentage: stats.ram_usage_percentage ?? null,
          uptime: stats.uptime ?? null,
        });
        setStatusMessage("Backend connected");
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(BACKEND_STATUS_KEY, "done");
        }
        pushToast("Backend connection established.", "success");
      } catch {
        setStatusMessage("Backend unavailable");
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(BACKEND_STATUS_KEY, "done");
        }
        pushToast("Frontend is running with local placeholder data.", "info");
      }
    }

    void loadBackendStatus();
  }, [pushToast]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (dashboardMode === "hidden") {
        return;
      }
      try {
        const stats = await storageApi.systemStats();
        setSystemStats({
          total_storage: stats.total_storage ?? null,
          used_storage: stats.used_storage ?? null,
          available_storage: stats.available_storage ?? null,
          storage_usage_percentage: stats.storage_usage_percentage ?? null,
          cpu_usage_percentage: stats.cpu_usage_percentage ?? null,
          ram_usage_percentage: stats.ram_usage_percentage ?? null,
          uptime: stats.uptime ?? null,
        });
      } catch {
        // Ignore transient refresh failures; the explorer remains available.
      }
    }, 10000);

    return () => window.clearInterval(timer);
  }, [dashboardMode]);

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
      label: "Storage Usage",
      value: systemStats.storage_usage_percentage == null ? "—" : `${Math.round(systemStats.storage_usage_percentage)}%`,
      detail: "of total used",
      tone: "neutral",
      icon: "◔",
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
    {
      label: "Uptime",
      value: systemStats.uptime ?? "—",
      detail: "System Uptime",
      tone: "teal",
      icon: "◷",
    },
  ];

  const dashboardSummary = `Storage ${systemStats.storage_usage_percentage == null ? "unknown" : `${Math.round(systemStats.storage_usage_percentage)}%`} used | CPU ${systemStats.cpu_usage_percentage == null ? "unknown" : `${Math.round(systemStats.cpu_usage_percentage)}%`} | RAM ${systemStats.ram_usage_percentage == null ? "unknown" : `${Math.round(systemStats.ram_usage_percentage)}%`}`;

  return (
    <div className="app-layout">
      <button
        type="button"
        className={`sidebar-backdrop ${isSidebarOpen ? "sidebar-backdrop-visible" : ""}`}
        aria-label="Close navigation"
        aria-hidden={!isSidebarOpen}
        onClick={() => setIsSidebarOpen(false)}
      />

      <aside className={`sidebar ${isSidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">
            🍓
          </div>
          <div>
            <h1>Pi Storage Manager</h1>
            <p>Your Personal File Manager</p>
          </div>
          <button
            type="button"
            className="sidebar-close-button"
            aria-label="Close navigation"
            onClick={() => setIsSidebarOpen(false)}
          >
            ✕
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Primary">
          {primaryLinks.map((link) => (
            <button
              key={link.label}
              type="button"
              className={`sidebar-link ${link.active ? "sidebar-link-active" : ""}`}
              onClick={() => setIsSidebarOpen(false)}
            >
              <span className="sidebar-link-icon" aria-hidden="true">
                {link.icon}
              </span>
              {link.label}
            </button>
          ))}
        </nav>

        <section className="sidebar-section">
          <span className="sidebar-section-title">Storage</span>
          <div className="sidebar-storage-card">
            <div className="sidebar-storage-head">
              <span className="sidebar-link-icon" aria-hidden="true">
                💾
              </span>
              <strong>Internal Storage</strong>
            </div>
            <div className="sidebar-storage-bar" aria-hidden="true">
              <span
                className="sidebar-storage-fill"
                style={{
                  width: systemStats.storage_usage_percentage == null ? "0%" : `${Math.min(100, Math.max(0, systemStats.storage_usage_percentage))}%`,
                }}
              />
            </div>
            <div className="sidebar-storage-meta">
              <span>
                {systemStats.used_storage && systemStats.total_storage
                  ? `${systemStats.used_storage} of ${systemStats.total_storage} used`
                  : "Checking storage..."}
              </span>
              <strong>{systemStats.storage_usage_percentage == null ? "—" : `${Math.round(systemStats.storage_usage_percentage)}%`}</strong>
            </div>
          </div>
        </section>

        <section className="sidebar-section">
          <span className="sidebar-section-title">Shortcuts</span>
          <div className="sidebar-shortcuts">
            {shortcuts.map((shortcut) => (
              <button
                key={shortcut.label}
                type="button"
                className="sidebar-shortcut"
                onClick={() => setIsSidebarOpen(false)}
              >
                <span className="sidebar-link-icon" aria-hidden="true">
                  {shortcut.icon}
                </span>
                {shortcut.label}
              </button>
            ))}
          </div>
        </section>

        <div className="sidebar-footer-card">
          <strong>Pi Storage Manager</strong>
          <span>v0.1.0</span>
          <div className="sidebar-status">
            <span className="sidebar-status-dot" aria-hidden="true" />
            System Online
          </div>
        </div>
      </aside>

      <main className="app-shell">
        <section className="workspace">
          <header className="mobile-topbar">
            <button
              type="button"
              className="mobile-menu-button"
              aria-label="Open navigation"
              onClick={() => setIsSidebarOpen(true)}
            >
              ☰
            </button>
            <div className="mobile-topbar-copy">
              <strong>Pi Storage Manager</strong>
              <span>{statusMessage}</span>
            </div>
          </header>

          <DashboardCards
            metrics={dashboardMetrics}
            mode={dashboardMode}
            summary={dashboardSummary}
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
