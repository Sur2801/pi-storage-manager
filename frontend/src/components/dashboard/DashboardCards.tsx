type MetricCard = {
  label: string;
  value: string;
  detail: string;
  tone: "blue" | "purple" | "green" | "neutral" | "orange" | "red" | "teal";
  icon: string;
};

type DashboardMode = "expanded" | "collapsed" | "hidden";

type DashboardCardsProps = {
  metrics: MetricCard[];
  mode: DashboardMode;
  summary: string;
  onModeChange: (mode: DashboardMode) => void;
};

const compactSummaryItems = [
  { label: "Storage", value: "30% used", icon: "🖴" },
  { label: "CPU", value: "18%", icon: "⚙" },
  { label: "RAM", value: "42%", icon: "▣" },
  { label: "Uptime", value: "3d 12h", icon: "◷" },
];

export function DashboardCards({ metrics, mode, onModeChange, summary }: DashboardCardsProps) {
  if (mode === "hidden") {
    return (
      <section className="dashboard-panel dashboard-panel-hidden">
        <div className="dashboard-heading-row">
          <div>
            <h2 className="dashboard-section-title">Dashboard</h2>
            <p className="dashboard-section-subtitle">Dashboard is hidden to maximize file space.</p>
          </div>
          <button type="button" className="compact-action-link" onClick={() => onModeChange("expanded")}>
            Show Dashboard
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="dashboard-panel">
      <div className="dashboard-heading-row">
        <div>
          <h2 className="dashboard-section-title">Dashboard</h2>
        </div>
        <button
          type="button"
          className="compact-action-link"
          onClick={() => onModeChange(mode === "expanded" ? "collapsed" : "expanded")}
        >
          {mode === "expanded" ? "Collapse Dashboard" : "Expand Dashboard"}
        </button>
      </div>

      {mode === "expanded" ? (
        <div className="dashboard-metrics-grid">
          {metrics.map((metric) => (
            <article key={metric.label} className="dashboard-metric-card">
              <div className={`metric-icon metric-icon-${metric.tone}`} aria-hidden="true">
                {metric.icon}
              </div>
              <div className="metric-copy">
                <span className="metric-title">{metric.label}</span>
                <strong className="metric-primary-value">{metric.value}</strong>
                <span className="metric-secondary-value">{metric.detail}</span>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <div className="dashboard-compact-row">
        <div className="dashboard-compact-items" aria-label={summary}>
          {compactSummaryItems.map((item) => (
            <div key={item.label} className="dashboard-compact-item">
              <span className="dashboard-compact-icon" aria-hidden="true">
                {item.icon}
              </span>
              <strong>{item.label}</strong>
              <span>{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
