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

function formatSyncDate(d) {
  if (!d) return '—';
  try {
    const s = String(d).includes(' ') ? String(d).replace(' ', 'T') + 'Z' : String(d);
    return new Date(s).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

export default function BranchDashboard({ wsEvents = [] }) {
  const { branchId } = useMode();
  const [logs,      setLogs]      = useState([]);
  const [config,    setConfig]    = useState({});
  const [status,    setStatus]    = useState(null);
  const [syncs,     setSyncs]     = useState([]);
  const [latency,   setLatency]   = useState(null);
  const [isOffline, setIsOffline] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      axios.get('/api/webhooks/logs?limit=10')
        .then(r => r.data.data ?? [])
        .catch(err => {
          console.error('Error cargando logs de webhooks:', err);
          return [];
        }),
      axios.get('/api/status')
        .then(r => r.data)
        .catch(err => {
          console.error('Error cargando status:', err);
          return null;
        }),
      axios.get('/api/cambios?limit=10')
        .then(r => r.data.data ?? [])
        .catch(err => {
          console.error('Error cargando cambios de auditoría:', err);
          return [];
        }),
    ]).then(([logsData, statusData, cambiosData]) => {
      setLogs(logsData);
      setStatus(statusData);
      setSyncs(cambiosData);
      if (statusData) {
        if (statusData.worker?.lastLatency != null) {
          setLatency(statusData.worker.lastLatency);
        }
        setIsOffline(!!statusData.worker?.isOffline);
      }
    });

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
    if (last) {
      if (last.event === 'sync_ok' && last.data?.ms !== undefined) {
        setLatency(last.data.ms);
        setIsOffline(false);
      } else if (last.event === 'sync_error' && last.data?.ms !== undefined) {
        setLatency(last.data.ms);
      } else if (last.event === 'worker_status' && last.data?.isOffline !== undefined) {
        setIsOffline(last.data.isOffline);
      }
    }
    if (
      last?.type === 'webhook_processed' ||
      last?.type === 'webhook_poll' ||
      last?.event === 'sync_ok' ||
      last?.event === 'sync_error'
    ) {
      load();
    }
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
          ok={!isOffline}
          label={isOffline ? 'PowerSales Caído' : 'Conexión a PowerSales'}
          sub={isOffline ? 'Cooldown activo (pausa de 2m)' : 'Online / Sincronizando'}
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'OK hoy',         val: counts.hoy,       color: '#34d399' },
          { label: 'Errores hoy',    val: counts.error,     color: '#f87171' },
          { label: 'Última Latencia',val: latency !== null ? `${latency} ms` : '—', color: '#a78bfa' },
          { label: 'Sync OK total',  val: counts.ok,       color: '#38bdf8' },
          { label: 'En cola',        val: counts.pendiente,color: '#fb923c' },
        ].map(k => (
          <div key={k.label} className="card" style={{ textAlign: 'center', padding: '14px 10px' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: k.color }}>{k.val ?? '—'}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Tablas de Actividad */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: 16 }}>
        {/* Últimos envíos ERP -> PowerSales */}
        <div className="card">
          <div className="section-title" style={{ marginBottom: 12 }}>Últimos envíos del ERP (Subida)</div>
          {syncs.length === 0 ? (
            <p style={{ color: '#6b7280', fontSize: 13 }}>Sin envíos registrados aún.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: '#9ca3af', borderBottom: '1px solid #374151', textAlign: 'left' }}>
                  <th style={{ padding: '6px 10px' }}>Entidad</th>
                  <th style={{ padding: '6px 10px' }}>Clave</th>
                  <th style={{ padding: '6px 10px' }}>Estado</th>
                  <th style={{ padding: '6px 10px' }}>Fecha sync</th>
                </tr>
              </thead>
              <tbody>
                {syncs.map(s => {
                  const estadoLabel = s.sincronizado === 1 ? 'OK' : s.sincronizado === 2 ? 'Error' : 'Pendiente';
                  const bg = s.sincronizado === 1 ? '#064e3b' : s.sincronizado === 2 ? '#450a0a' : '#431407';
                  const fg = s.sincronizado === 1 ? '#34d399' : s.sincronizado === 2 ? '#f87171' : '#fb923c';
                  return (
                    <tr key={s.id} style={{ borderBottom: '1px solid #1f2937' }}>
                      <td style={{ padding: '7px 10px', color: '#38bdf8' }}>{s.tabla}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontSize: 12 }}>{s.clave_registro}</td>
                      <td style={{ padding: '7px 10px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: bg, color: fg }}>
                          {estadoLabel}
                        </span>
                      </td>
                      <td style={{ padding: '7px 10px', color: '#6b7280', fontSize: 11 }}>
                        {formatSyncDate(s.fecha_sync || s.fecha_cambio)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Últimos webhooks procesados PowerSales -> ERP */}
        <div className="card">
          <div className="section-title" style={{ marginBottom: 12 }}>Últimos webhooks procesados (Bajada)</div>
          {logs.length === 0 ? (
            <p style={{ color: '#6b7280', fontSize: 13 }}>Sin registros locales aún.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: '#9ca3af', borderBottom: '1px solid #374151', textAlign: 'left' }}>
                  <th style={{ padding: '6px 10px' }}>Entidad</th>
                  <th style={{ padding: '6px 10px' }}>Clave</th>
                  <th style={{ padding: '6px 10px' }}>Estado</th>
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
                    <td style={{ padding: '7px 10px', color: '#6b7280', fontSize: 11 }}>
                      {formatSyncDate(l.fecha_recepcion)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
