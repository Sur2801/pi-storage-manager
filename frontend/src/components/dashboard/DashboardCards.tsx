type MetricCard = {
  label: string;
  value: string;
};

const metrics: MetricCard[] = [
  { label: "Total Storage", value: "4.0 TB" },
  { label: "Used Storage", value: "1.2 TB" },
  { label: "Available Storage", value: "2.8 TB" },
  { label: "Storage Usage %", value: "30%" },
  { label: "CPU Usage", value: "18%" },
  { label: "RAM Usage", value: "42%" },
  { label: "Uptime", value: "3d 12h" },
];

export function DashboardCards() {
  return (
    <section className="card">
      <div className="section-header">
        <h2>Dashboard</h2>
      </div>
      <div className="metrics-grid">
        {metrics.map((metric) => (
          <article key={metric.label} className="metric-card">
            <span className="metric-label">{metric.label}</span>
            <strong className="metric-value">{metric.value}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

