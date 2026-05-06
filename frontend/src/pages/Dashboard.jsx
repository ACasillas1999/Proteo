import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import KpiCard   from '../components/KpiCard.jsx';
import SyncChart from '../components/SyncChart.jsx';
import LiveFeed  from '../components/LiveFeed.jsx';

function buildChartData(cambios) {
  const buckets = {};
  const now = new Date();
  // init 24 buckets
  for (let i = 23; i >= 0; i--) {
    const h = new Date(now - i * 3600_000);
    const key = `${String(h.getHours()).padStart(2,'0')}:00`;
    buckets[key] = { hora: key, ok: 0, error: 0 };
  }
  for (const c of cambios) {
    const d = new Date(c.fecha_sync || c.fecha_cambio);
    const key = `${String(d.getHours()).padStart(2,'0')}:00`;
    if (buckets[key]) {
      if (c.sincronizado === 1) buckets[key].ok++;
      if (c.sincronizado === 2) buckets[key].error++;
    }
  }
  return Object.values(buckets);
}

export default function Dashboard({ wsEvents }) {
  const [status,  setStatus]  = useState(null);
  const [chart,   setChart]   = useState([]);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([
        axios.get('/api/status'),
        axios.get('/api/cambios?limit=200&sincronizado='),
      ]);
      if (s.data.ok) setStatus(s.data);
      if (c.data.ok) setChart(buildChartData(c.data.data));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  // Refresh KPIs when new sync event arrives
  useEffect(() => {
    const last = wsEvents[0];
    if (last?.event === 'sync_ok' || last?.event === 'sync_error') load();
  }, [wsEvents, load]);

  const counts  = status?.counts  || {};
  const runtime = status?.runtime || {};

  return (
    <div>
      <h1 className="section-title" style={{ marginBottom: 20 }}>
        ⚡ Dashboard
      </h1>

      {/* KPI row */}
      <div className="kpi-grid">
        <KpiCard label="Sincronizados hoy"   value={counts.hoy}       sub="registros OK"     variant="green"  delay={0} />
        <KpiCard label="Errores pendientes"  value={counts.error}     sub="sin resolver"     variant="red"    delay={80} />
        <KpiCard label="En cola"             value={counts.pendiente} sub="sin procesar"     variant="orange" delay={160} />
        <KpiCard label="Velocidad promedio"  value={runtime.avgMs ? `${runtime.avgMs}ms` : '—'} sub="por sincronización" variant="cyan" delay={240} />
      </div>

      {/* Chart + Feed */}
      <div className="dash-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <SyncChart data={chart} />
          </div>
          {/* Totals summary */}
          <div className="card">
            <div className="section-title">Resumen total</div>
            <div style={{ display: 'flex', gap: 24 }}>
              {[
                { label: 'Total OK',       val: counts.ok,       color: 'var(--green)' },
                { label: 'Total errores',  val: counts.error,    color: 'var(--red)' },
                { label: 'Total pendiente',val: counts.pendiente,color: 'var(--orange)' },
              ].map(item => (
                <div key={item.label}>
                  <div className="text-muted" style={{ fontSize: 11, marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: item.color }}>{item.val ?? '—'}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Live feed */}
        <div className="card" style={{ minHeight: 400 }}>
          <LiveFeed events={wsEvents} />
        </div>
      </div>
    </div>
  );
}
