import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Modal, { ModalField } from '../components/Modal.jsx';

const ESTADO_MAP = {
  0: { label: 'Pendiente', cls: 'badge--orange' },
  1: { label: 'OK',        cls: 'badge--green' },
  2: { label: 'Error',     cls: 'badge--red' },
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

export default function Auditoria() {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [filters, setFilters] = useState({ tabla: '', sincronizado: '', fecha: '' });
  const [modal,   setModal]   = useState(null);
  const [loading, setLoading] = useState(false);
  const LIMIT = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: LIMIT };
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
          value={filters.tabla}
          onChange={e => { setFilters(f => ({ ...f, tabla: e.target.value })); setPage(1); }}
        >
          <option value="">Todas las tablas</option>
          <option value="articulo">articulo</option>
          <option value="cliente">cliente</option>
          <option value="proveedor">proveedor</option>
        </select>

        <select
          value={filters.sincronizado}
          onChange={e => { setFilters(f => ({ ...f, sincronizado: e.target.value })); setPage(1); }}
        >
          <option value="">Todos los estados</option>
          <option value="0">Pendiente</option>
          <option value="1">OK</option>
          <option value="2">Error</option>
        </select>

        <button className="btn btn--ghost btn--sm" onClick={load}>🔄 Actualizar</button>

        {errCount > 0 && (
          <button className="btn btn--red btn--sm ml-auto" onClick={retryAll}>
            ↺ Reintentar todos ({errCount})
          </button>
        )}
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
                  <th>Tabla</th>
                  <th>Clave</th>
                  <th>Campos</th>
                  <th>Fecha cambio</th>
                  <th>Estado</th>
                  <th>Fecha sync</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const est = ESTADO_MAP[r.sincronizado] || ESTADO_MAP[0];
                  return (
                    <tr
                      key={r.id}
                      className="clickable"
                      onClick={() => r.sincronizado === 2 && setModal(r)}
                      title={r.sincronizado === 2 ? 'Click para ver error' : ''}
                    >
                      <td style={{ color: 'var(--text-muted)' }}>#{r.id}</td>
                      <td><span className="badge badge--cyan">{r.tabla}</span></td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.clave_registro}</td>
                      <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 12 }}>
                        {r.campos_modificados}
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{fmtDate(r.fecha_cambio)}</td>
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
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>Sin resultados</td></tr>
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
