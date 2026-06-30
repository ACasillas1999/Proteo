import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useMode } from '../context/ModeContext.jsx';

function timeSince(dateStr) {
  if (!dateStr) return '—';
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h`;
}

function StatusDot({ ok, label, sub }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '16px 20px', background: '#111827', borderRadius: 10,
      border: `1px solid ${ok ? '#065f46' : '#7f1d1d'}`,
    }}>
      <div style={{
        width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
        background: ok ? '#34d399' : '#f87171',
        boxShadow: ok ? '0 0 8px #34d399' : '0 0 8px #f87171',
      }} />
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: ok ? '#34d399' : '#f87171' }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

export default function BranchDashboard({ wsEvents = [] }) {
  const { branchId } = useMode();
  const [logs,      setLogs]      = useState([]);
  const [config,    setConfig]    = useState({});
  const [status,    setStatus]    = useState(null);

  const load = useCallback(() => {
    Promise.all([
      axios.get('/api/webhooks/logs?limit=20'),
      axios.get('/api/status'),
    ]).then(([l, s]) => {
      setLogs(l.data.data ?? []);
      setStatus(s.data);
    }).catch(() => {});

    // Leer last_poll_at desde config
    axios.get('/api/config').then(r => setConfig(r.data.data ?? {})).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const last = wsEvents[0];
    if (last?.type === 'webhook_processed' || last?.type === 'webhook_poll') load();
  }, [wsEvents, load]);

  const counts    = status?.counts  || {};
  const lastPoll  = config.last_poll_at;
  const erpOk     = (counts.ok ?? 0) >= 0; // proxy: si status responde, ERP funciona
  const pollerOk  = lastPoll && (Date.now() - new Date(lastPoll).getTime()) < 2 * 60 * 1000;

  const todayLogs  = logs.filter(l => l.estado === 1).length;
  const errorLogs  = logs.filter(l => l.estado === 2).length;

  return (
    <div>
      <h1 className="section-title" style={{ marginBottom: 6 }}>
        ⚡ Sucursal {branchId ?? '—'}
      </h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>
        Último poll: {lastPoll ? timeSince(lastPoll) : 'sin datos'} atrás
      </p>

      {/* Semáforos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatusDot
          ok={true}
          label="Proteo corriendo"
          sub="Servidor activo"
        />
        <StatusDot
          ok={!!pollerOk}
          label={pollerOk ? 'Poller activo' : 'Poller inactivo'}
          sub={lastPoll ? `Último poll hace ${timeSince(lastPoll)}` : 'Sin polls aún'}
        />
        <StatusDot
          ok={counts.error === 0 || counts.error == null}
          label={counts.error > 0 ? `${counts.error} errores pendientes` : 'Sin errores pendientes'}
          sub="Cola de sincronización"
        />
      </div>

      {/* Stats rápidos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'OK hoy',         val: todayLogs,       color: '#34d399' },
          { label: 'Errores hoy',    val: errorLogs,       color: '#f87171' },
          { label: 'Sync OK total',  val: counts.ok,       color: '#38bdf8' },
          { label: 'En cola',        val: counts.pendiente,color: '#fb923c' },
        ].map(k => (
          <div key={k.label} className="card" style={{ textAlign: 'center', padding: '14px 10px' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: k.color }}>{k.val ?? '—'}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Últimos webhooks procesados localmente */}
      <div className="card">
        <div className="section-title" style={{ marginBottom: 12 }}>Últimos webhooks procesados</div>
        {logs.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: 13 }}>Sin registros locales aún.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#9ca3af', borderBottom: '1px solid #374151', textAlign: 'left' }}>
                <th style={{ padding: '6px 10px' }}>Entidad</th>
                <th style={{ padding: '6px 10px' }}>Clave</th>
                <th style={{ padding: '6px 10px' }}>Estado</th>
                <th style={{ padding: '6px 10px' }}>Error</th>
                <th style={{ padding: '6px 10px' }}>Recibido</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid #1f2937' }}>
                  <td style={{ padding: '7px 10px', color: '#38bdf8' }}>{l.entidad}</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontSize: 12 }}>{l.clave_registro}</td>
                  <td style={{ padding: '7px 10px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                      background: l.estado === 1 ? '#064e3b' : '#450a0a',
                      color:      l.estado === 1 ? '#34d399' : '#f87171',
                    }}>
                      {l.estado === 1 ? 'OK' : 'Error'}
                    </span>
                  </td>
                  <td style={{ padding: '7px 10px', color: '#f87171', fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.error_msg || '—'}
                  </td>
                  <td style={{ padding: '7px 10px', color: '#6b7280', fontSize: 11 }}>
                    {l.fecha_recepcion ? new Date(l.fecha_recepcion).toLocaleString('es-MX') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
