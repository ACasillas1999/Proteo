import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Modal, { ModalField } from '../components/Modal.jsx';

const ESTADO_MAP = {
  0: { label: 'Pendiente', cls: 'badge--orange' },
  1: { label: 'OK',        cls: 'badge--green' },
  2: { label: 'Error',     cls: 'badge--red' },
  3: { label: 'Local',     cls: 'badge--gray' },
};

function getPriorityInfo(tabla, prioridad) {
  const t = String(tabla || '').toLowerCase();
  const p = Number(prioridad) || (
    (t === 'surtidopedido' || t === 'clientes') ? 1 :
    t === 'articuloalm' ? 2 :
    t === 'tipocamb' ? 3 :
    t === 'articulo' ? 4 : 2
  );

  if (p === 1) {
    return {
      level: 1,
      label: '⚡ P1 · Urgente',
      desc: 'Se envía primero (Pedidos / Clientes)',
      bg: 'rgba(16, 185, 129, 0.16)',
      color: '#34d399',
      border: 'rgba(16, 185, 129, 0.35)',
    };
  }
  if (p === 2) {
    return {
      level: 2,
      label: '🚀 P2 · Alta',
      desc: 'Existencias de almacén (articuloalm)',
      bg: 'rgba(56, 189, 248, 0.16)',
      color: '#38bdf8',
      border: 'rgba(56, 189, 248, 0.35)',
    };
  }
  if (p === 3) {
    return {
      level: 3,
      label: '💱 P3 · Media',
      desc: 'Tipo de cambio (antes que artículos)',
      bg: 'rgba(167, 139, 250, 0.16)',
      color: '#c4b5fd',
      border: 'rgba(167, 139, 250, 0.35)',
    };
  }
  return {
    level: 4,
    label: '📦 P4 · Masivo',
    desc: 'Catálogo de artículos (menor prioridad)',
    bg: 'rgba(148, 163, 184, 0.14)',
    color: '#94a3b8',
    border: 'rgba(148, 163, 184, 0.3)',
  };
}

function fmtDate(d) {
  if (!d) return '—';
  let date;
  if (d instanceof Date) {
    // mysql2 ya devuelve Date objects en UTC
    date = d;
  } else if (typeof d === 'string') {
    // String tipo "2026-05-06 03:25:00" → añadir Z para tratar como UTC
    const s = d.includes('T') ? d : d.replace(' ', 'T');
    date = new Date(s.endsWith('Z') ? s : s + 'Z');
  } else {
    date = new Date(d);
  }
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

export default function Auditoria() {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [filters, setFilters] = useState({ tabla: '', sincronizado: '', sort: 'priority' });
  const [modal,   setModal]   = useState(null);
  const [loading, setLoading] = useState(false);
  const LIMIT = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: LIMIT, sort: filters.sort || 'priority' };
      if (filters.tabla)       params.tabla = filters.tabla;
      if (filters.sincronizado !== '') params.sincronizado = filters.sincronizado;
      const { data } = await axios.get('/api/cambios', { params });
      if (data.ok) { setRows(data.data); setTotal(data.total); }
    } catch { /* ignore */ }
    setLoading(false);
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  const retry = async (id, e) => {
    e.stopPropagation();
    await axios.post(`/api/cambios/retry/${id}`);
    load();
  };

  const retryAll = async () => {
    await axios.post('/api/cambios/retry-all');
    load();
  };

  const totalPages = Math.ceil(total / LIMIT);
  const errCount   = rows.filter(r => r.sincronizado === 2).length;

  return (
    <div>
      <h1 className="section-title">
        📋 Auditoría de Cambios
        <span>{total} registros</span>
      </h1>

      {/* Filters */}
      <div className="filters">
        <select
          value={filters.sort}
          onChange={e => { setFilters(f => ({ ...f, sort: e.target.value })); setPage(1); }}
          title="Orden de visualización"
        >
          <option value="priority">🔼 Orden de Subida (Prioridad arriba → menor abajo)</option>
          <option value="recent">🕒 Cronológico (Más recientes primero)</option>
        </select>

        <select
          value={filters.tabla}
          onChange={e => { setFilters(f => ({ ...f, tabla: e.target.value })); setPage(1); }}
        >
          <option value="">Todas las tablas</option>
          <option value="surtidopedido">surtidopedido (P1 · Urgente)</option>
          <option value="clientes">clientes (P1 · Urgente)</option>
          <option value="articuloalm">articuloalm (P2 · Alta)</option>
          <option value="Tipocamb">Tipocamb (P3 · Media)</option>
          <option value="articulo">articulo (P4 · Masivo)</option>
        </select>

        <select
          value={filters.sincronizado}
          onChange={e => { setFilters(f => ({ ...f, sincronizado: e.target.value })); setPage(1); }}
        >
          <option value="">Todos los estados</option>
          <option value="0">⏳ Solo Cola Pendiente (Por subir)</option>
          <option value="1">OK</option>
          <option value="2">Error</option>
          <option value="3">Local</option>
        </select>

        <button className="btn btn--ghost btn--sm" onClick={load}>🔄 Actualizar</button>

        {errCount > 0 && (
          <button className="btn btn--red btn--sm ml-auto" onClick={retryAll}>
            ↺ Reintentar todos ({errCount})
          </button>
        )}
      </div>

      {/* Leyenda de prioridades de subida */}
      <div style={{
        display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
        marginBottom: 14, padding: '8px 14px', borderRadius: 8,
        background: 'rgba(15, 23, 42, 0.6)', border: '1px solid var(--border)', fontSize: 12
      }}>
        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Orden de subida:</span>
        <span style={{ padding: '2px 9px', borderRadius: 100, background: 'rgba(16,185,129,.16)', color: '#34d399', fontWeight: 600 }}>
          1º ⚡ surtidopedido / clientes
        </span>
        <span style={{ color: 'var(--text-muted)' }}>→</span>
        <span style={{ padding: '2px 9px', borderRadius: 100, background: 'rgba(56,189,248,.16)', color: '#38bdf8', fontWeight: 600 }}>
          2º 🚀 articuloalm
        </span>
        <span style={{ color: 'var(--text-muted)' }}>→</span>
        <span style={{ padding: '2px 9px', borderRadius: 100, background: 'rgba(167,139,250,.16)', color: '#c4b5fd', fontWeight: 600 }}>
          3º 💱 Tipocamb
        </span>
        <span style={{ color: 'var(--text-muted)' }}>→</span>
        <span style={{ padding: '2px 9px', borderRadius: 100, background: 'rgba(148,163,184,.14)', color: '#94a3b8', fontWeight: 600 }}>
          4º 📦 articulo
        </span>
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
                  <th>ID</th>
                  <th>Prioridad / Turno</th>
                  <th>Tabla</th>
                  <th>Clave</th>
                  <th>Campos</th>
                  <th>Fecha cambio</th>
                  <th>Servidor</th>
                  <th>Estado</th>
                  <th>Fecha sync</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let pendingCounter = (page - 1) * LIMIT;
                  return rows.map(r => {
                    const est = ESTADO_MAP[r.sincronizado] || ESTADO_MAP[0];
                    const prio = getPriorityInfo(r.tabla, r.prioridad);
                    const isPending = r.sincronizado === 0;
                    const queueTurn = isPending ? (++pendingCounter) : null;

                    return (
                      <tr
                        key={r.id}
                        className="clickable"
                        onClick={() => r.sincronizado === 2 && setModal(r)}
                        title={r.sincronizado === 2 ? 'Click para ver error' : prio.desc}
                        style={isPending ? { background: 'rgba(251, 146, 60, 0.04)' } : undefined}
                      >
                        <td style={{ color: 'var(--text-muted)' }}>#{r.id}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              padding: '2px 9px',
                              borderRadius: 100,
                              fontSize: 11,
                              fontWeight: 600,
                              background: prio.bg,
                              color: prio.color,
                              border: `1px solid ${prio.border}`,
                              whiteSpace: 'nowrap',
                            }}>
                              {prio.label}
                            </span>
                            {isPending && filters.sort === 'priority' && (
                              <span style={{
                                padding: '2px 7px',
                                borderRadius: 6,
                                fontSize: 10,
                                fontWeight: 700,
                                background: queueTurn === 1 ? 'rgba(251, 191, 36, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                                color: queueTurn === 1 ? '#fbbf24' : 'var(--text-muted)',
                                whiteSpace: 'nowrap',
                              }}>
                                {queueTurn === 1 ? '🎯 Siguiente (#1)' : `Turno #${queueTurn}`}
                              </span>
                            )}
                          </div>
                        </td>
                        <td><span className="badge badge--cyan">{r.tabla}</span></td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.clave_registro}</td>
                        <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 12 }}>
                          {r.campos_modificados}
                        </td>
                        <td style={{ color: 'var(--text-muted)' }}>{fmtDate(r.fecha_cambio)}</td>
                        <td>
                          <span style={{ fontSize: 12, color: r.procesado_por ? '#38bdf8' : 'var(--text-muted)' }}>
                            {r.procesado_por || '—'}
                          </span>
                        </td>
                        <td><span className={`badge ${est.cls}`}>{est.label}</span></td>
                        <td style={{ color: 'var(--text-muted)' }}>{fmtDate(r.fecha_sync)}</td>
                        <td>
                          {r.sincronizado === 2 && (
                            <button className="btn btn--red btn--sm" onClick={e => retry(r.id, e)}>
                              ↺
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  });
                })()}
                {rows.length === 0 && (
                  <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>Sin resultados</td></tr>
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

      {/* Error detail modal */}
      <Modal open={!!modal} onClose={() => setModal(null)} title={`Detalle error — Cambio #${modal?.id}`}>
        {modal && (
          <>
            <ModalField label="Tabla"><p>{modal.tabla}</p></ModalField>
            <ModalField label="Clave Registro"><p>{modal.clave_registro}</p></ModalField>
            <ModalField label="Campos modificados"><p>{modal.campos_modificados}</p></ModalField>
            <ModalField label="Fecha cambio"><p>{fmtDate(modal.fecha_cambio)}</p></ModalField>
            <ModalField label="Servidor"><p>{modal.procesado_por || '—'}</p></ModalField>
            <ModalField label="Error">
              <pre>{modal.error_sync || 'Sin detalle'}</pre>
            </ModalField>
            <div style={{ marginTop: 16 }}>
              <button
                className="btn btn--red"
                onClick={() => { retry(modal.id, { stopPropagation: () => {} }); setModal(null); }}
              >
                ↺ Reintentar este registro
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
