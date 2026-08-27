type MetricCard = {
  label: string;
  value: string;
  detail: string;
  tone: "blue" | "purple" | "green" | "neutral" | "orange" | "red" | "teal";
  icon: string;
  variant?: "storage" | "gauge";
  percent?: number;
  subLabel?: string;
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
  const storageMetric = metrics.find((metric) => metric.variant === "storage");
  const gaugeMetrics = metrics.filter((metric) => metric.variant === "gauge");

  const renderStorageBar = (percent: number) => {
    const segments = Array.from({ length: 40 }, (_, index) => index < Math.round((percent / 100) * 40));
    return (
      <div className="dashboard-storage-bar" aria-label={`Storage usage ${percent}%`}>
        {segments.map((filled, index) => (
          <span key={`${filled}-${index}`} className={`dashboard-storage-segment ${filled ? "filled" : "empty"}`} />
        ))}
      </div>
    );
  };

  const renderGauge = (metric: MetricCard) => {
    const percent = metric.percent ?? 0;
    const ringColor = metric.tone === "green" ? "#3fc1b3" : metric.tone === "red" ? "#e76a5a" : "#7bb2ff";
    const trackColor = "#ebf0ef";

    return (
      <article key={metric.label} className="dashboard-gauge-card">
        <div className="dashboard-gauge-header">
          <span className="dashboard-gauge-label">{metric.label}</span>
        </div>
        <div className="dashboard-gauge-wrap">
          <div
            className="dashboard-gauge-ring"
            aria-label={`${metric.label} ${metric.value}`}
            style={{
              background: `conic-gradient(${ringColor} 0 ${percent}%, ${trackColor} ${percent}% 100%)`,
            }}
          >
            <div className="dashboard-gauge-inner">
              <strong>{metric.value}</strong>
            </div>
          </div>
        </div>
        <div className="dashboard-gauge-subtitle">{metric.detail}</div>
      </article>
    );
  };

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
        <div className="dashboard-usage-grid">
          {isLoading ? (
            <>
              <article className="dashboard-storage-card dashboard-skeleton-card" aria-busy="true">
                <div className="dashboard-skeleton dashboard-skeleton-icon" aria-hidden="true" />
                <div className="dashboard-skeleton dashboard-skeleton-line dashboard-skeleton-line-medium" />
                <div className="dashboard-skeleton dashboard-skeleton-line-long" />
              </article>
              {gaugeMetrics.map((metric) => (
                <article key={metric.label} className="dashboard-gauge-card dashboard-skeleton-card" aria-busy="true">
                  <div className="dashboard-skeleton dashboard-skeleton-ring" aria-hidden="true" />
                </article>
              ))}
            </>
          ) : (
            <>
              {storageMetric ? (
                <article className="dashboard-storage-card">
                  <div className="dashboard-storage-header">
                    <div className="dashboard-storage-value-block">
                      <strong>{storageMetric.value}</strong>
                      <span>{storageMetric.detail}</span>
                    </div>
                  </div>
                  {renderStorageBar(storageMetric.percent ?? 0)}
                  <div className="dashboard-storage-details">
                    <span>{storageMetric.subLabel}</span>
                  </div>
                </article>
              ) : null}
              {gaugeMetrics.map(renderGauge)}
            </>
          )}
        </div>
      ) : null}
      {errorMessage ? <p className="dashboard-error-message">{errorMessage}</p> : null}
    </section>
  );
}
