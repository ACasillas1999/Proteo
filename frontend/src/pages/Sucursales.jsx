import { useState, useEffect } from 'react';
import axios from 'axios';

const REFRESH_MS = 60_000;

function timeSince(dateStr) {
  if (!dateStr) return '—';
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h`;
}

export default function Sucursales({ wsEvents = [] }) {
  const [branches, setBranches] = useState([]);
  const [loading,  setLoading]  = useState(true);

  const fetchStatus = () => {
    axios.get('/api/branches/status')
      .then(r => setBranches(r.data.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  // Actualizar en tiempo real cuando llega heartbeat vía WS
  useEffect(() => {
    const hb = wsEvents.findLast?.(e => e.type === 'branch_heartbeat');
    if (hb) fetchStatus();
  }, [wsEvents]);

  if (loading) return <div className="page-content"><p>Cargando sucursales…</p></div>;

  return (
    <div className="page-content">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Sucursales</h2>
        <span style={{ fontSize: 13, color: '#6b7280' }}>{branches.length} registradas</span>
        <button
          onClick={fetchStatus}
          style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 13, cursor: 'pointer' }}
        >
          Actualizar
        </button>
      </div>

      {branches.length === 0 ? (
        <p style={{ color: '#6b7280' }}>Sin sucursales registradas. Activa una sucursal para que aparezca aquí.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #374151', textAlign: 'left', color: '#9ca3af' }}>
              <th style={{ padding: '8px 12px' }}>Branch ID</th>
              <th style={{ padding: '8px 12px' }}>Hostname</th>
              <th style={{ padding: '8px 12px' }}>Último heartbeat</th>
              <th style={{ padding: '8px 12px' }}>Último webhook</th>
              <th style={{ padding: '8px 12px' }}>ERP</th>
              <th style={{ padding: '8px 12px' }}>Versión</th>
              <th style={{ padding: '8px 12px' }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {branches.map(b => (
              <tr key={b.branch_id} style={{ borderBottom: '1px solid #1f2937' }}>
                <td style={{ padding: '10px 12px', fontWeight: 600 }}>{b.branch_id}</td>
                <td style={{ padding: '10px 12px', color: '#d1d5db' }}>{b.hostname || '—'}</td>
                <td style={{ padding: '10px 12px', color: '#9ca3af', fontSize: 13 }}>{timeSince(b.last_seen_at)}</td>
                <td style={{ padding: '10px 12px', color: '#9ca3af', fontSize: 13 }}>#{b.last_poll_id ?? 0}</td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{ color: b.erp_connected ? '#34d399' : '#f87171', fontSize: 18 }}>
                    {b.erp_connected ? '✓' : '✗'}
                  </span>
                </td>
                <td style={{ padding: '10px 12px', color: '#9ca3af', fontSize: 12 }}>{b.app_version || '—'}</td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 10px',
                    borderRadius: 12,
                    fontSize: 12,
                    fontWeight: 600,
                    background: b.online ? '#064e3b' : '#1f2937',
                    color:      b.online ? '#34d399' : '#6b7280',
                  }}>
                    {b.online ? 'Online' : 'Offline'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
