import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Modal, { ModalField } from '../components/Modal.jsx';

const ESTADO_MAP = {
  0: { label: 'Pendiente', cls: 'badge--orange' },
  1: { label: 'OK',        cls: 'badge--green'  },
  2: { label: 'Error',     cls: 'badge--red'    },
};

function fmtDate(d) {
  if (!d) return '—';
  let date;
  if (d instanceof Date) {
    date = d;
  } else if (typeof d === 'string') {
    // fecha_recepcion viene del MySQL LOCAL (UTC-6)
    const s = d.includes('T') ? d : d.replace(' ', 'T');
    date = new Date(s);
  } else {
    date = new Date(d);
  }
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

function JsonViewer({ data }) {
  if (!data) return <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin payload recibido</p>;

  let parsed;
  try {
    parsed = typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    return <pre style={{ color: 'var(--red)', fontSize: 12 }}>{String(data)}</pre>;
  }

  return (
    <pre style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '12px 16px',
      fontSize: 12,
      lineHeight: 1.6,
      overflowX: 'auto',
      color: 'var(--text)',
      maxHeight: 420,
      overflowY: 'auto',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}>
      {JSON.stringify(parsed, null, 2)}
    </pre>
  );
}

export default function Webhooks({ wsEvents = [] }) {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [filters, setFilters] = useState({ entidad: '', estado: '' });
  const [modal,   setModal]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState([]);
  const LIMIT = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: LIMIT };
      if (filters.entidad) params.entidad = filters.entidad;
      if (filters.estado !== '') params.estado = filters.estado;
      const { data } = await axios.get('/api/webhooks/logs', { params });
      if (data.ok) { setRows(data.data); setTotal(data.total); }
    } catch { /* ignore */ }
    setLoading(false);
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!wsEvents || wsEvents.length === 0) return;
    const lastEvent = wsEvents[0];
    if (!lastEvent) return;

    const ts = new Date(lastEvent.ts || Date.now()).toLocaleTimeString('es-MX');
    
    if (lastEvent.event === 'webhook_received') {
      const { object } = lastEvent.data || {};
      const newLog = {
        time: ts,
        type: 'info',
        text: `📥 Petición POST recibida - Objeto: '${object}'`
      };
      setConsoleLogs(prev => [newLog, ...prev].slice(0, 100));
      load();
    } else if (lastEvent.event === 'webhook_processed') {
      const { entidad, clave_registro, estado, error_msg } = lastEvent.data || {};
      let type = 'success';
      let text = `✅ Procesado exitosamente: ${entidad} (${clave_registro})`;
      if (estado === 2) {
        type = 'error';
        text = `❌ Error al procesar: ${entidad} (${clave_registro}) - ${error_msg || 'Error desconocido'}`;
      }
      const newLog = {
        time: ts,
        type,
        text
      };
      setConsoleLogs(prev => [newLog, ...prev].slice(0, 100));
      load();
    }
  }, [wsEvents, load]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div>
      <h1 className="section-title">
        📥 Webhooks Recibidos
        <span>{total} registros</span>
      </h1>

      {/* Real-time console */}
      <div className="card" style={{ padding: 0, marginBottom: 20, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div style={{
          background: 'var(--surface-header, #1e293b)',
          padding: '10px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border)'
        }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444' }} />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981' }} />
            <span style={{ marginLeft: 10, fontSize: 12, fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-muted)' }}>
              Live Webhook Monitor
            </span>
          </div>
          <button
            className="btn btn--ghost btn--sm"
            style={{ padding: '4px 8px', fontSize: 11 }}
            onClick={() => setConsoleLogs([])}
          >
            🗑️ Limpiar Consola
          </button>
        </div>
        <div style={{
          background: '#0f172a',
          color: '#38bdf8',
          fontFamily: 'monospace',
          fontSize: 12,
          padding: 16,
          height: 180,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: 6
        }}>
          {consoleLogs.map((log, idx) => {
            let color = '#38bdf8'; // Blue for info
            if (log.type === 'success') color = '#4ade80'; // Green for success
            if (log.type === 'error') color = '#f87171'; // Red for error
            
            return (
              <div key={idx} style={{ display: 'flex', gap: 8 }}>
                <span style={{ color: '#64748b' }}>[{log.time}]</span>
                <span style={{ color }}>{log.text}</span>
              </div>
            );
          })}
          {consoleLogs.length === 0 && (
            <div style={{ color: '#64748b', fontStyle: 'italic', textAlign: 'center', padding: '60px 0' }}>
              📟 Consola lista. Esperando peticiones webhook en tiempo real...
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="filters">
        <select
          value={filters.entidad}
          onChange={e => { setFilters(f => ({ ...f, entidad: e.target.value })); setPage(1); }}
        >
          <option value="">Todas las entidades</option>
          <option value="articulo">articulo (products)</option>
          <option value="cliente">cliente (customers)</option>
        </select>

        <select
          value={filters.estado}
          onChange={e => { setFilters(f => ({ ...f, estado: e.target.value })); setPage(1); }}
        >
          <option value="">Todos los estados</option>
          <option value="1">OK</option>
          <option value="2">Error</option>
        </select>

        <button className="btn btn--ghost btn--sm" onClick={load}>🔄 Actualizar</button>
      </div>

      {/* Table */}
      <div className="card">
        <div className="tbl-wrap">
          {loading ? (
            <p className="text-muted" style={{ padding: 20 }}>Cargando…</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Entidad</th>
                  <th>Clave</th>
                  <th>Estado</th>
                  <th>Fecha recepción</th>
                  <th>Payload</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const est = ESTADO_MAP[r.estado] || ESTADO_MAP[0];
                  const hasPayload = !!r.datos;
                  return (
                    <tr
                      key={r.id}
                      className={hasPayload ? 'clickable' : ''}
                      onClick={() => hasPayload && setModal(r)}
                      title={hasPayload ? 'Click para ver payload' : ''}
                    >
                      <td style={{ color: 'var(--text-muted)' }}>#{r.id}</td>
                      <td><span className="badge badge--cyan">{r.entidad}</span></td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.clave_registro}</td>
                      <td><span className={`badge ${est.cls}`}>{est.label}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}>{fmtDate(r.fecha_recepcion)}</td>
                      <td>
                        {hasPayload ? (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={e => { e.stopPropagation(); setModal(r); }}
                            title="Ver JSON recibido"
                          >
                            🔍 Ver
                          </button>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                    Sin webhooks recibidos
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div className="pagination">
          <span>Página {page} de {totalPages || 1}</span>
          <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Anterior</button>
          <button className="btn btn--ghost btn--sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Siguiente →</button>
        </div>
      </div>

      {/* Payload detail modal */}
      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={`Webhook Recibido — #${modal?.id} · ${modal?.clave_registro}`}
      >
        {modal && (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <span className="badge badge--cyan">{modal.entidad}</span>
              <span className={`badge ${(ESTADO_MAP[modal.estado] || ESTADO_MAP[0]).cls}`}>
                {(ESTADO_MAP[modal.estado] || ESTADO_MAP[0]).label}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12, alignSelf: 'center' }}>
                {fmtDate(modal.fecha_recepcion)}
              </span>
            </div>

            {modal.error_msg && (
              <ModalField label="Error / Mensaje">
                <pre style={{ color: 'var(--red)', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {modal.error_msg}
                </pre>
              </ModalField>
            )}

            <ModalField label="JSON recibido desde PowerSales">
              <JsonViewer data={modal.datos} />
            </ModalField>

            <div style={{ marginTop: 12, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  try {
                    const parsed = typeof modal.datos === 'string' ? JSON.parse(modal.datos) : modal.datos;
                    navigator.clipboard.writeText(JSON.stringify(parsed, null, 2));
                  } catch {
                    navigator.clipboard.writeText(String(modal.datos));
                  }
                }}
              >
                📋 Copiar JSON
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
