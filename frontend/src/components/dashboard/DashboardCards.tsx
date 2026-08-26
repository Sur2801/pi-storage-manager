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
  isLoading: boolean;
  errorMessage: string | null;
  onModeChange: (mode: DashboardMode) => void;
};

export function DashboardCards({ metrics, mode, onModeChange, isLoading, errorMessage }: DashboardCardsProps) {
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
          {isLoading
            ? metrics.map((metric) => (
                <article key={metric.label} className="dashboard-metric-card dashboard-metric-card-loading" aria-busy="true">
                  <div className="dashboard-skeleton dashboard-skeleton-icon" aria-hidden="true" />
                  <div className="metric-copy">
                    <span className="dashboard-skeleton dashboard-skeleton-line dashboard-skeleton-line-short" />
                    <span className="dashboard-skeleton dashboard-skeleton-line dashboard-skeleton-line-medium" />
                    <span className="dashboard-skeleton dashboard-skeleton-line dashboard-skeleton-line-short" />
                  </div>
                </article>
              ))
            : metrics.map((metric) => (
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
      {errorMessage ? <p className="dashboard-error-message">{errorMessage}</p> : null}
    </section>
  );
}
