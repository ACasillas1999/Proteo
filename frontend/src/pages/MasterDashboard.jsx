import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import KpiCard  from '../components/KpiCard.jsx';
import LiveFeed from '../components/LiveFeed.jsx';

function timeSince(dateStr) {
  if (!dateStr) return '—';
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 60)   return `hace ${secs}s`;
  if (secs < 3600) return `hace ${Math.floor(secs / 60)}m`;
  return `hace ${Math.floor(secs / 3600)}h`;
}

export default function MasterDashboard({ wsEvents = [] }) {
  const [digest,  setDigest]  = useState([]);
  const [totals,  setTotals]  = useState({});
  const [feed,    setFeed]    = useState([]);

  const loadDigest = useCallback(() => {
    axios.get('/api/branches/digest').then(r => setDigest(r.data.data ?? [])).catch(() => {});
    axios.get('/api/status').then(r => setTotals(r.data.counts ?? {})).catch(() => {});
  }, []);

  useEffect(() => {
    loadDigest();
    const t = setInterval(loadDigest, 30_000);
    return () => clearInterval(t);
  }, [loadDigest]);

  // Live feed: acumular eventos WS de heartbeats y polls
  useEffect(() => {
    if (!wsEvents.length) return;
    const last = wsEvents[0];
    if (!last) return;

    if (last.type === 'branch_heartbeat') {
      setFeed(prev => [{
        ts:    new Date().toISOString(),
        label: `Branch ${last.branch_id}`,
        msg:   `Heartbeat — ERP: ${last.erp_connected ? '✓' : '✗'} · Poll ID: ${last.last_poll_id ?? '—'}`,
        ok:    last.erp_connected,
      }, ...prev].slice(0, 150));
      loadDigest();
    }
    if (last.type === 'webhook_received') {
      setFeed(prev => [{
        ts:    new Date().toISOString(),
        label: 'Maestro',
        msg:   `Webhook recibido — ${last.entidad ?? '?'} · branch: ${last.branch_id ?? '?'}`,
        ok:    true,
      }, ...prev].slice(0, 150));
    }
  }, [wsEvents, loadDigest]);

  const onlineCount  = digest.filter(b => b.online).length;
  const offlineCount = digest.filter(b => !b.online).length;
  const totalPending = digest.reduce((s, b) => s + (b.pending_count ?? 0), 0);

  return (
    <div>
      <h1 className="section-title" style={{ marginBottom: 20 }}>⚡ Maestro — Vista Global</h1>

      {/* KPIs */}
      <div className="kpi-grid">
        <KpiCard label="Sucursales online"  value={onlineCount}    sub="conectadas"       variant="green"  delay={0}   />
        <KpiCard label="Sucursales offline" value={offlineCount}   sub="sin heartbeat"    variant="red"    delay={80}  />
        <KpiCard label="Webhooks pendientes"value={totalPending}   sub="sin jalar"        variant="orange" delay={160} />
        <KpiCard label="Sync OK hoy"        value={totals.hoy}     sub="registros"        variant="cyan"   delay={240} />
      </div>

      <div className="dash-grid">
        {/* Tabla de sucursales */}
        <div className="card" style={{ overflow: 'auto' }}>
          <div className="section-title" style={{ marginBottom: 12 }}>Estado por sucursal</div>
          {digest.length === 0 ? (
            <p style={{ color: '#6b7280', fontSize: 13 }}>Sin sucursales registradas aún.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: '#9ca3af', borderBottom: '1px solid #374151', textAlign: 'left' }}>
                  <th style={{ padding: '6px 10px' }}>Branch</th>
                  <th style={{ padding: '6px 10px' }}>Hostname</th>
                  <th style={{ padding: '6px 10px' }}>Estado</th>
                  <th style={{ padding: '6px 10px' }}>ERP</th>
                  <th style={{ padding: '6px 10px' }}>Último pull</th>
                  <th style={{ padding: '6px 10px' }}>Pendientes</th>
                  <th style={{ padding: '6px 10px' }}>Heartbeat</th>
                </tr>
              </thead>
              <tbody>
                {digest.map(b => (
                  <tr key={b.branch_id} style={{ borderBottom: '1px solid #1f2937' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 700 }}>{b.branch_id}</td>
                    <td style={{ padding: '8px 10px', color: '#d1d5db' }}>{b.hostname || '—'}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                        background: b.online ? '#064e3b' : '#1f2937',
                        color:      b.online ? '#34d399' : '#6b7280',
                      }}>
                        {b.online ? 'Online' : 'Offline'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <span style={{ color: b.erp_connected ? '#34d399' : '#f87171' }}>
                        {b.erp_connected ? '✓' : '✗'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', color: '#9ca3af', fontSize: 12 }}>#{b.last_poll_id ?? 0}</td>
                    <td style={{ padding: '8px 10px' }}>
                      {b.pending_count > 0 ? (
                        <span style={{ color: '#fb923c', fontWeight: 700 }}>{b.pending_count}</span>
                      ) : (
                        <span style={{ color: '#34d399' }}>0</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#9ca3af', fontSize: 12 }}>{timeSince(b.last_seen_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Live feed */}
        <div className="card" style={{ minHeight: 400, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="section-title">Feed en tiempo real</div>
          {feed.length === 0 ? (
            <p style={{ color: '#6b7280', fontSize: 13 }}>Esperando eventos…</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflow: 'auto', maxHeight: 500 }}>
              {feed.map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12, borderBottom: '1px solid #1f2937', paddingBottom: 6 }}>
                  <span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>
                    {new Date(e.ts).toLocaleTimeString('es-MX')}
                  </span>
                  <span style={{ color: '#38bdf8', fontWeight: 600, whiteSpace: 'nowrap' }}>{e.label}</span>
                  <span style={{ color: e.ok ? '#d1d5db' : '#f87171' }}>{e.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
