export default function KpiCard({ label, value, sub, variant = 'cyan', delay = 0 }) {
  return (
    <div className={`kpi-card kpi-card--${variant}`} style={{ animationDelay: `${delay}ms` }}>
      <div className="kpi-card__label">{label}</div>
      <div className="kpi-card__value">{value ?? '—'}</div>
      {sub && <div className="kpi-card__sub">{sub}</div>}
    </div>
  );
}
