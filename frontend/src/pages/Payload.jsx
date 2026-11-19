import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Modal, { ModalField } from '../components/Modal.jsx';

const ESTADO_MAP = {
  0: { label: 'Pendiente', cls: 'badge--orange' },
  1: { label: 'OK',        cls: 'badge--green'  },
  2: { label: 'Error',     cls: 'badge--red'    },
  3: { label: 'Local',     cls: 'badge--gray'   },
};

function fmtDate(d) {
  if (!d) return '—';
  let date;
  if (d instanceof Date) {
    date = d;
  } else if (typeof d === 'string') {
    // fecha_sync viene del MySQL LOCAL (UTC-6), NO añadir Z
    // Si añadiéramos Z lo trataría como UTC y restaría 6h más → mostraría 3am en vez de 9am
    const s = d.includes('T') ? d : d.replace(' ', 'T');
    date = new Date(s); // sin Z → JS lo interpreta como hora local
  } else {
    date = new Date(d);
  }
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

const PRICE_LIST_ID_MAP = {
  Precio_Lista: 1,
  Precio_Venta: 2,
  Precio_Especial: 3,
  Precio4: 4,
};

const BASE_API_URL = 'https://api.powersales.cloud/api/grupoascencio';

function normalizePayloadSections(parsed, entidad, estado) {
  if (!parsed || typeof parsed !== 'object') return null;

  // 1. Formato nuevo de articulo: ya trae las 3 llaves con { data: [...] }
  if (parsed['POST /products'] || parsed['POST /pricelistsdetails'] || parsed['POST /discountlistdetail']) {
    return [
      { endpoint: `POST ${BASE_API_URL}/products`, shortEndpoint: 'POST /products', body: parsed['POST /products'] },
      { endpoint: `POST ${BASE_API_URL}/pricelistsdetails`, shortEndpoint: 'POST /pricelistsdetails', body: parsed['POST /pricelistsdetails'] },
      { endpoint: `POST ${BASE_API_URL}/discountlistdetail`, shortEndpoint: 'POST /discountlistdetail', body: parsed['POST /discountlistdetail'] },
    ].filter(s => s.body !== undefined);
  }

  // 2. Formato anterior de articulo guardado en BD: { product, priceListsDetails, discountListsDetails }
  if (parsed.product && (parsed.priceListsDetails || parsed.discountListsDetails)) {
    const sku = String(parsed.product.SKU || parsed.product.ProductCode || '');
    const cost = String(parseFloat(parsed.product.Cost) || 0);
    let pldArray = [];

    if (Array.isArray(parsed.priceListsDetails)) {
      pldArray = parsed.priceListsDetails;
    } else if (parsed.priceListsDetails && typeof parsed.priceListsDetails === 'object') {
      pldArray = Object.entries(parsed.priceListsDetails).map(([plName, priceVal]) => ({
        ProductId: sku,
        PriceListId: PRICE_LIST_ID_MAP[plName] ?? plName,
        Cost: cost,
        Price: String(priceVal),
        IsActive: 1,
      }));
    }

    return [
      { endpoint: `POST ${BASE_API_URL}/products`, shortEndpoint: 'POST /products', body: { data: [parsed.product] } },
      { endpoint: `POST ${BASE_API_URL}/pricelistsdetails`, shortEndpoint: 'POST /pricelistsdetails', body: { data: pldArray } },
      { endpoint: `POST ${BASE_API_URL}/discountlistdetail`, shortEndpoint: 'POST /discountlistdetail', body: { data: parsed.discountListsDetails || [] } },
    ];
  }

  const ent = String(entidad || '').toLowerCase();

  // 3. Clientes -> POST /customers { data: [ ... ] }
  if (ent === 'clientes' || ent === 'cliente') {
    const body = parsed.data ? parsed : { data: Array.isArray(parsed) ? parsed : [parsed] };
    return [
      { endpoint: `POST ${BASE_API_URL}/customers`, shortEndpoint: 'POST /customers', body }
    ];
  }

  // 4. Inventario por almacén -> POST /warehouseinventory { data: [ ... ] }
  if (ent === 'articuloalm') {
    const body = parsed.data ? parsed : { data: Array.isArray(parsed) ? parsed : [parsed] };
    return [
      { endpoint: `POST ${BASE_API_URL}/warehouseinventory`, shortEndpoint: 'POST /warehouseinventory', body }
    ];
  }

  // 5. Surtido de pedido -> POST /orders { data: { ... } } (o Local)
  if (ent === 'surtidopedido') {
    if (estado === 3 || parsed.Origen) {
      return [
        { endpoint: 'Registro Local ERP (No se envía a PowerSales)', shortEndpoint: 'JSON Local', body: parsed }
      ];
    }
    const body = parsed.data ? parsed : { data: parsed };
    return [
      { endpoint: `POST ${BASE_API_URL}/orders`, shortEndpoint: 'POST /orders', body }
    ];
  }

  // 6. Tipo de Cambio -> POST /currencyexchange
  if (ent === 'tipocamb') {
    const body = parsed.payload ? parsed.payload : parsed;
    return [
      { endpoint: `POST ${BASE_API_URL}/currencyexchange`, shortEndpoint: 'POST /currencyexchange', body }
    ];
  }

  return null;
}

function JsonViewer({ data, entidad, estado }) {
  if (!data) return <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin payload guardado</p>;

  let parsed;
  try {
    parsed = typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    return <pre style={{ color: 'var(--red)', fontSize: 12 }}>{String(data)}</pre>;
  }

  const preStyle = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '12px 16px',
    fontSize: 12,
    lineHeight: 1.6,
    overflowX: 'auto',
    color: 'var(--text)',
    maxHeight: 320,
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };

  const sections = normalizePayloadSections(parsed, entidad, estado);
  if (sections) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {sections.map(sec => (
          <div key={sec.endpoint}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
              <span className="badge badge--cyan" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {sec.endpoint}
              </span>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => navigator.clipboard.writeText(JSON.stringify(sec.body, null, 2))}
              >
                📋 Copiar {sec.shortEndpoint || sec.endpoint}
              </button>
            </div>
            <pre style={preStyle}>
              {JSON.stringify(sec.body, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    );
  }

  return (
    <pre style={{ ...preStyle, maxHeight: 420 }}>
      {JSON.stringify(parsed, null, 2)}
    </pre>
  );
}

export default function Payload() {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [filters, setFilters] = useState({ entidad: '', estado: '' });
  const [modal,   setModal]   = useState(null);
  const [loading, setLoading] = useState(false);
  const LIMIT = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: LIMIT };
      if (filters.entidad) params.entidad = filters.entidad;
      if (filters.estado !== '') params.estado = filters.estado;
      const { data } = await axios.get('/api/sync-history', { params });
      if (data.ok) { setRows(data.data); setTotal(data.total); }
    } catch { /* ignore */ }
    setLoading(false);
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div>
      <h1 className="section-title">
        📤 Payloads Enviados
        <span>{total} registros</span>
      </h1>

      {/* Filters */}
      <div className="filters">
        <select
          value={filters.entidad}
          onChange={e => { setFilters(f => ({ ...f, entidad: e.target.value })); setPage(1); }}
        >
          <option value="">Todas las entidades</option>
          <option value="articulo">articulo</option>
          <option value="articuloalm">articuloalm</option>
          <option value="clientes">clientes</option>
          <option value="surtidopedido">surtidopedido</option>
          <option value="Tipocamb">Tipocamb</option>
        </select>

        <select
          value={filters.estado}
          onChange={e => { setFilters(f => ({ ...f, estado: e.target.value })); setPage(1); }}
        >
          <option value="">Todos los estados</option>
          <option value="1">OK</option>
          <option value="2">Error</option>
          <option value="3">Local</option>
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
                  <th>Operación</th>
                  <th>Intentos</th>
                  <th>Estado</th>
                  <th>Latencia</th>
                  <th>Fecha sync</th>
                  <th>Payload</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const est = ESTADO_MAP[r.estado] || ESTADO_MAP[0];
                  const hasPayload = !!r.datos;
                  const hasError = !!r.error_msg;
                  const canView = hasPayload || hasError;
                  return (
                    <tr
                      key={r.id}
                      className={canView ? 'clickable' : ''}
                      onClick={() => canView && setModal(r)}
                      title={canView ? 'Click para ver detalles' : ''}
                    >
                      <td style={{ color: 'var(--text-muted)' }}>#{r.id}</td>
                      <td><span className="badge badge--cyan">{r.entidad}</span></td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.clave_registro}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{r.operacion}</td>
                      <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{r.intentos}</td>
                      <td><span className={`badge ${est.cls}`}>{est.label}</span></td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                        {r.latency_ms !== null && r.latency_ms !== undefined ? `${(r.latency_ms / 1000).toFixed(2)}s` : '—'}
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{fmtDate(r.fecha_sync)}</td>
                      <td>
                        {canView ? (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={e => { e.stopPropagation(); setModal(r); }}
                            title={hasError ? "Ver error y JSON" : "Ver JSON enviado"}
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
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                    Sin registros en historial
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
        title={`Payload enviado — #${modal?.id} · ${modal?.clave_registro}`}
      >
        {modal && (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <span className="badge badge--cyan">{modal.entidad}</span>
              <span className={`badge ${(ESTADO_MAP[modal.estado] || ESTADO_MAP[0]).cls}`}>
                {(ESTADO_MAP[modal.estado] || ESTADO_MAP[0]).label}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12, alignSelf: 'center' }}>
                {fmtDate(modal.fecha_sync)}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12, alignSelf: 'center' }}>
                {modal.intentos} intento(s)
              </span>
              {modal.latency_ms !== null && modal.latency_ms !== undefined && (
                <span style={{ color: 'var(--text-muted)', fontSize: 12, alignSelf: 'center' }}>
                  ⏱️ Latencia: {(modal.latency_ms / 1000).toFixed(2)}s ({modal.latency_ms} ms)
                </span>
              )}
            </div>

            {modal.error_msg && (
              <ModalField label={modal.estado === 3 ? "Origen / Detalle" : "Error"}>
                <pre style={{ color: modal.estado === 3 ? 'var(--cyan)' : 'var(--red)', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {modal.error_msg}
                </pre>
              </ModalField>
            )}

            <ModalField label="JSON enviado a PowerSales">
              <JsonViewer data={modal.datos} entidad={modal.entidad} estado={modal.estado} />
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
