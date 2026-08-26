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

type SidebarLink = {
  label: string;
  icon: string;
  active?: boolean;
};

const DASHBOARD_STORAGE_KEY = "pi-storage-manager-dashboard-mode";

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

const dashboardMetrics: DashboardMetric[] = [
  { label: "Total Storage", value: "4.0 TB", detail: "Total Capacity", tone: "blue", icon: "💽" },
  { label: "Used Storage", value: "1.2 TB", detail: "Used", tone: "purple", icon: "👜" },
  { label: "Available Storage", value: "2.8 TB", detail: "Available", tone: "green", icon: "🗃" },
  { label: "Storage Usage", value: "30%", detail: "of total used", tone: "neutral", icon: "◔" },
  { label: "CPU Usage", value: "18%", detail: "2 Cores", tone: "orange", icon: "⚙" },
  { label: "RAM Usage", value: "42%", detail: "1.6 GB of 4 GB", tone: "red", icon: "▣" },
  { label: "Uptime", value: "3d 12h", detail: "System Uptime", tone: "teal", icon: "◷" },
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
    if (backendCheckDoneRef.current) {
      return;
    }
    backendCheckDoneRef.current = true;

    async function loadPlaceholders() {
      try {
        await Promise.all([storageApi.health(), storageApi.systemStats()]);
        setStatusMessage("Backend connected");
        pushToast("Backend connection established.", "success");
      } catch {
        setStatusMessage("Backend unavailable");
        pushToast("Frontend is running with local placeholder data.", "info");
      }
    }

    void loadPlaceholders();
  }, [pushToast]);

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
              <span className="sidebar-storage-fill" />
            </div>
            <div className="sidebar-storage-meta">
              <span>1.2 TB of 4.0 TB used</span>
              <strong>30%</strong>
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
            summary="Storage 30% used | CPU 18% | RAM 42%"
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
