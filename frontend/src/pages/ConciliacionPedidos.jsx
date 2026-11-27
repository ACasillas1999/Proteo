import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import KpiCard from '../components/KpiCard.jsx';
import Modal, { ModalField } from '../components/Modal.jsx';

function getPsStatusBadge(statusId, statusName = '') {
  const sId = Number(statusId);
  const sName = String(statusName || '').toUpperCase().trim();

  if (sId === 11) {
    return { label: `St 11 · ${sName || 'COTIZADO'}`, sub: 'Solo Cotización (cbcot)', bg: 'rgba(167, 139, 250, 0.16)', color: '#c4b5fd', border: '#6d28d9' };
  }
  if (sId === 41) {
    return { label: `St 41 · ${sName || 'ORDER_CREATED'}`, sub: 'Pedido (Dist: 0)', bg: 'rgba(56, 189, 248, 0.16)', color: '#38bdf8', border: '#0284c7' };
  }
  if (sId === 38 || sId === 42) {
    return { label: `St ${sId} · ${sName || 'PROCESSED'}`, sub: 'Pedido Liberado (Dist: 1)', bg: 'rgba(16, 185, 129, 0.16)', color: '#34d399', border: '#059669' };
  }
  if (sId === 43 || sId === 6) {
    return { label: `St ${sId} · ${sName || 'PICKED'}`, sub: sId === 43 ? 'Surtido Completo' : 'Surtido Parcial', bg: 'rgba(20, 184, 166, 0.16)', color: '#2dd4bf', border: '#0d9488' };
  }
  if (sId === 7 || sName === 'INVOICED') {
    return { label: `St 7 · ${sName || 'INVOICED'}`, sub: 'Facturado (Datos SAT)', bg: 'rgba(251, 191, 36, 0.16)', color: '#fbbf24', border: '#d97706' };
  }
  if (sId === 8 || sName.includes('CANCEL')) {
    return { label: `St 8 · ${sName || 'CANCELLED'}`, sub: 'Cancelado (Estatus: C)', bg: 'rgba(248, 113, 113, 0.16)', color: '#f87171', border: '#dc2626' };
  }
  return { label: `St ${sId} · ${sName || 'SIN DEFINIR'}`, sub: 'Borrador / Omitido en Magic', bg: 'rgba(148, 163, 184, 0.14)', color: '#94a3b8', border: '#475569' };
}

function getDiagnosisBadge(diag) {
  if (!diag) return { bg: '#1e293b', color: '#94a3b8', border: '#334155', icon: '•' };
  switch (diag.code) {
    case 'SYNC_OK':
      return { bg: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '#065f46', icon: '✓' };
    case 'MISSING_IN_MAGIC':
      return { bg: 'rgba(239, 68, 68, 0.16)', color: '#f87171', border: '#991b1b', icon: '✗' };
    case 'STATUS_MISMATCH':
      return { bg: 'rgba(245, 158, 11, 0.16)', color: '#fbbf24', border: '#92400e', icon: '⚠' };
    case 'PENDING_QUEUE':
      return { bg: 'rgba(251, 146, 60, 0.16)', color: '#fb923c', border: '#9a3412', icon: '⏳' };
    case 'DRAFT_OMITTED':
      return { bg: 'rgba(148, 163, 184, 0.12)', color: '#94a3b8', border: '#334155', icon: '⏭' };
    default:
      return { bg: 'rgba(148, 163, 184, 0.12)', color: '#94a3b8', border: '#334155', icon: '?' };
  }
}

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(Number(n))) return '—';
  return '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateShort(d) {
  if (!d) return '—';
  const s = String(d);
  if (s.length === 10 && s.includes('-')) return s;
  const parsed = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  if (isNaN(parsed.getTime())) return s;
  return parsed.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

export default function ConciliacionPedidos() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [branches, setBranches] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resyncingMap, setResyncingMap] = useState({});
  const [bulkResyncing, setBulkResyncing] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);

  // Filtros
  const [search, setSearch] = useState('');
  const [diagFilter, setDiagFilter] = useState('ALL');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [psStatusFilter, setPsStatusFilter] = useState('ALL');

  const fetchReconciliation = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const { data } = await axios.get('/api/reconciliation/orders', { params: { max_pages: 10 } });
      if (data.ok) {
        setRows(data.data || []);
        setSummary(data.summary || null);
        setBranches(data.branches || []);
        setMeta(data.meta || null);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        msg: `Error al consultar conciliación: ${err.response?.data?.error || err.message}`,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReconciliation();
  }, [fetchReconciliation]);

  const handleResyncOrders = async (orderNumbers) => {
    if (!orderNumbers || orderNumbers.length === 0) return;
    const isBulk = orderNumbers.length > 1;
    if (isBulk) setBulkResyncing(true);
    else setResyncingMap(prev => ({ ...prev, [orderNumbers[0]]: true }));

    setFeedback(null);
    try {
      const { data } = await axios.post('/api/reconciliation/resync', { orderNumbers });
      if (data.ok) {
        setFeedback({
          type: 'ok',
          msg: `${data.message}${data.triggeredBranches?.length ? ` · Poll disparado en Sucursal(es): ${data.triggeredBranches.join(', ')}` : ''}`,
        });
        setTimeout(() => { fetchReconciliation(); }, 1800);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        msg: `Error al re-sincronizar: ${err.response?.data?.error || err.message}`,
      });
    } finally {
      if (isBulk) setBulkResyncing(false);
      else setResyncingMap(prev => ({ ...prev, [orderNumbers[0]]: false }));
    }
  };

  // Lista única de StatusId presentes en PowerSales para el selector
  const availablePsStatuses = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.statusId)) {
        map.set(r.statusId, r.statusName);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [rows]);

  // Filtrado en cliente
  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      if (diagFilter !== 'ALL') {
        if (diagFilter === 'ISSUES') {
          if (r.diagnosis?.code !== 'MISSING_IN_MAGIC' && r.diagnosis?.code !== 'STATUS_MISMATCH') return false;
        } else if (r.diagnosis?.code !== diagFilter) {
          return false;
        }
      }
      if (branchFilter !== 'ALL' && String(r.branchId) !== String(branchFilter)) return false;
      if (psStatusFilter !== 'ALL' && String(r.statusId) !== String(psStatusFilter)) return false;

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchOrder = String(r.orderNumber || '').toLowerCase().includes(q);
        const matchPsId = String(r.psId || '').toLowerCase().includes(q);
        const matchNoPed = String(r.magic?.pedido?.No_Pedido || '').toLowerCase().includes(q);
        const matchNoCot = String(r.magic?.cotizacion?.No_Cotiza || '').toLowerCase().includes(q);
        const matchCust = String(r.customer?.name || '').toLowerCase().includes(q) || String(r.customer?.number || '').toLowerCase().includes(q);
        if (!matchOrder && !matchPsId && !matchNoPed && !matchNoCot && !matchCust) return false;
      }
      return true;
    });
  }, [rows, diagFilter, branchFilter, psStatusFilter, search]);

  const actionableIssueOrders = useMemo(() => {
    return filteredRows
      .filter(r => r.diagnosis?.code === 'MISSING_IN_MAGIC' || r.diagnosis?.code === 'STATUS_MISMATCH')
      .map(r => r.orderNumber);
  }, [filteredRows]);

  return (
    <div>
      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 className="section-title" style={{ margin: 0 }}>🔍 Conciliación de Pedidos (PowerSales ↔ Magic)</h1>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
            Consulta en vivo el <code style={{ color: '#38bdf8' }}>GET /orders</code> de la API de PowerSales y compara cada pedido contra Magic (<code style={{ color: '#34d399' }}>cbpedvta</code> / <code style={{ color: '#c4b5fd' }}>cbcot</code>) y la cola de Webhooks.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {actionableIssueOrders.length > 0 && (
            <button
              className="btn"
              disabled={bulkResyncing || loading}
              onClick={() => handleResyncOrders(actionableIssueOrders)}
              style={{
                background: '#991b1b',
                color: '#fecaca',
                border: '1px solid #dc2626',
                padding: '8px 14px',
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {bulkResyncing
                ? 'Sincronizando…'
                : `⚡ Sincronizar Faltantes/Desfasados (${actionableIssueOrders.length})`}
            </button>
          )}

          <button
            className="btn btn--primary"
            disabled={loading}
            onClick={fetchReconciliation}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            {loading ? 'Consultando PS & Magic…' : '🔄 Consultar API PowerSales & Magic'}
          </button>
        </div>
      </div>

      {/* Estado de conexión con Sucursales / Magic */}
      {branches.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          {branches.map(b => (
            <div
              key={b.branch_id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 14px',
                background: '#111827',
                borderRadius: 8,
                border: `1px solid ${b.magicReachable ? '#065f46' : '#7f1d1d'}`,
                fontSize: 12,
              }}
            >
              <span style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: b.magicReachable ? '#34d399' : '#f87171',
                boxShadow: b.magicReachable ? '0 0 6px #34d399' : '0 0 6px #f87171',
              }} />
              <span style={{ fontWeight: 700, color: '#f3f4f6' }}>Sucursal {b.branch_id}</span>
              <span style={{ color: '#9ca3af' }}>({b.hostname})</span>
              <span style={{
                padding: '1px 7px',
                borderRadius: 6,
                fontSize: 11,
                background: b.magicReachable ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: b.magicReachable ? '#34d399' : '#f87171',
                fontWeight: 600,
              }}>
                {b.magicReachable
                  ? (b.magicSource === 'branch_ws' ? 'Magic Online (WS)' : 'Magic Online (BD Local)')
                  : 'Magic Sin Conexión'}
              </span>
              <span style={{ color: '#6b7280', fontSize: 11 }}>Último Pull: #{b.last_poll_id}</span>
            </div>
          ))}
        </div>
      )}

      {/* Alerta de feedback */}
      {feedback && (
        <div style={{
          marginBottom: 16,
          padding: '10px 14px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 500,
          background: feedback.type === 'ok' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.16)',
          border: `1px solid ${feedback.type === 'ok' ? '#059669' : '#dc2626'}`,
          color: feedback.type === 'ok' ? '#34d399' : '#f87171',
        }}>
          {feedback.msg}
        </div>
      )}

      {/* KPIs */}
      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        <div onClick={() => setDiagFilter('ALL')} style={{ cursor: 'pointer' }}>
          <KpiCard
            label="Total en PowerSales"
            value={summary?.totalPs ?? '—'}
            sub={meta ? `GET /orders (${meta.pagesFetched} pág)` : 'pedidos en API'}
            variant="cyan"
            delay={0}
          />
        </div>
        <div onClick={() => setDiagFilter('SYNC_OK')} style={{ cursor: 'pointer' }}>
          <KpiCard
            label="Sincronizados en Magic"
            value={summary?.syncOk ?? '—'}
            sub="en cbpedvta / cbcot OK"
            variant="green"
            delay={60}
          />
        </div>
        <div onClick={() => setDiagFilter('MISSING_IN_MAGIC')} style={{ cursor: 'pointer' }}>
          <KpiCard
            label="En PS pero NO en Magic"
            value={summary?.missingInMagic ?? '—'}
            sub="faltantes por insertar"
            variant="red"
            delay={120}
          />
        </div>
        <div onClick={() => setDiagFilter('STATUS_MISMATCH')} style={{ cursor: 'pointer' }}>
          <KpiCard
            label="Estatus Desfasado"
            value={summary?.statusMismatch ?? '—'}
            sub="estatus PS ≠ Magic"
            variant="orange"
            delay={180}
          />
        </div>
        <div onClick={() => setDiagFilter('PENDING_QUEUE')} style={{ cursor: 'pointer' }}>
          <KpiCard
            label="Pendientes en Cola"
            value={summary?.pendingQueue ?? '—'}
            sub="esperando pull sucursal"
            variant="orange"
            delay={240}
          />
        </div>
        <div onClick={() => setDiagFilter('DRAFT_OMITTED')} style={{ cursor: 'pointer' }}>
          <KpiCard
            label="Borradores / Omitidos"
            value={summary?.draftOmitted ?? '—'}
            sub="St 1 Draft / St 3 Sin Definir"
            variant="cyan"
            delay={300}
          />
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Buscar por OrderNumber, No_Pedido, No_Cotiza o Cliente…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: '1 1 240px',
            padding: '7px 12px',
            borderRadius: 6,
            border: '1px solid #374151',
            background: '#111827',
            color: '#f3f4f6',
            fontSize: 13,
          }}
        />

        <select
          value={diagFilter}
          onChange={e => setDiagFilter(e.target.value)}
          style={{
            padding: '7px 10px',
            borderRadius: 6,
            border: '1px solid #374151',
            background: '#111827',
            color: '#f3f4f6',
            fontSize: 13,
          }}
        >
          <option value="ALL">Diagnóstico: Todos ({rows.length})</option>
          <option value="ISSUES">🚨 Solo Con Falla (Faltantes + Desfasados) ({(summary?.missingInMagic || 0) + (summary?.statusMismatch || 0)})</option>
          <option value="MISSING_IN_MAGIC">❌ En PS pero NO en Magic ({summary?.missingInMagic || 0})</option>
          <option value="STATUS_MISMATCH">⚠️ Desfasados de Estatus ({summary?.statusMismatch || 0})</option>
          <option value="PENDING_QUEUE">⏳ Pendientes en Cola ({summary?.pendingQueue || 0})</option>
          <option value="SYNC_OK">✅ Sincronizados OK ({summary?.syncOk || 0})</option>
          <option value="DRAFT_OMITTED">⏭️ Borradores / Omitidos ({summary?.draftOmitted || 0})</option>
        </select>

        <select
          value={psStatusFilter}
          onChange={e => setPsStatusFilter(e.target.value)}
          style={{
            padding: '7px 10px',
            borderRadius: 6,
            border: '1px solid #374151',
            background: '#111827',
            color: '#f3f4f6',
            fontSize: 13,
          }}
        >
          <option value="ALL">Estatus PS: Todos</option>
          {availablePsStatuses.map(([sId, sName]) => (
            <option key={sId} value={sId}>Status {sId} — {sName}</option>
          ))}
        </select>

        {branches.length > 1 && (
          <select
            value={branchFilter}
            onChange={e => setBranchFilter(e.target.value)}
            style={{
              padding: '7px 10px',
              borderRadius: 6,
              border: '1px solid #374151',
              background: '#111827',
              color: '#f3f4f6',
              fontSize: 13,
            }}
          >
            <option value="ALL">Sucursal: Todas</option>
            {branches.map(b => (
              <option key={b.branch_id} value={b.branch_id}>Sucursal {b.branch_id}</option>
            ))}
          </select>
        )}

        {(diagFilter !== 'ALL' || psStatusFilter !== 'ALL' || branchFilter !== 'ALL' || search) && (
          <button
            onClick={() => {
              setDiagFilter('ALL');
              setPsStatusFilter('ALL');
              setBranchFilter('ALL');
              setSearch('');
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid #374151',
              background: 'transparent',
              color: '#9ca3af',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Tabla Comparativa PowerSales vs Magic */}
      <div className="card" style={{ overflowX: 'auto' }}>
        {loading && rows.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center', color: '#9ca3af' }}>
            Consultando pedidos en PowerSales API y verificando tablas <code style={{ color: '#34d399' }}>cbpedvta</code> / <code style={{ color: '#c4b5fd' }}>cbcot</code> en Magic…
          </div>
        ) : filteredRows.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center', color: '#6b7280' }}>
            No se encontraron pedidos con los filtros seleccionados.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: '#9ca3af', borderBottom: '1px solid #374151', textAlign: 'left' }}>
                <th style={{ padding: '10px 10px' }}>Pedido PS (Folio / ID)</th>
                <th style={{ padding: '10px 10px' }}>Cliente / Vendedor</th>
                <th style={{ padding: '10px 10px' }}>Total PS</th>
                <th style={{ padding: '10px 10px' }}>Estatus en PowerSales (API GET)</th>
                <th style={{ padding: '10px 10px' }}>Estado en Magic (cbpedvta / cbcot)</th>
                <th style={{ padding: '10px 10px' }}>Cola / Webhook</th>
                <th style={{ padding: '10px 10px' }}>Diagnóstico</th>
                <th style={{ padding: '10px 10px', textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(r => {
                const psBadge = getPsStatusBadge(r.statusId, r.statusName);
                const diagBadge = getDiagnosisBadge(r.diagnosis);
                const ped = r.magic?.pedido;
                const cot = r.magic?.cotizacion;
                const mWh = r.webhook?.master;
                const bWh = r.webhook?.branch;
                const isResyncing = Boolean(resyncingMap[r.orderNumber]);

                return (
                  <tr
                    key={`${r.psId}-${r.orderNumber}`}
                    style={{
                      borderBottom: '1px solid #1f2937',
                      background: r.diagnosis?.code === 'MISSING_IN_MAGIC'
                        ? 'rgba(239, 68, 68, 0.04)'
                        : r.diagnosis?.code === 'STATUS_MISMATCH'
                        ? 'rgba(245, 158, 11, 0.04)'
                        : 'transparent',
                    }}
                  >
                    {/* Col 1: Folio PS */}
                    <td style={{ padding: '10px 10px', verticalAlign: 'top' }}>
                      <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: '#f3f4f6' }}>
                        {r.orderNumber}
                      </div>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                        ID PS: <span style={{ color: '#d1d5db' }}>#{r.psId}</span> · Branch: <span style={{ color: '#38bdf8', fontWeight: 600 }}>{r.branchId}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>
                        📅 {r.orderDate || fmtDateShort(r.createdDate)} · {r.itemsCount} renglón(es)
                      </div>
                    </td>

                    {/* Col 2: Cliente / Vendedor */}
                    <td style={{ padding: '10px 10px', verticalAlign: 'top', maxWidth: 210 }}>
                      <div style={{ fontWeight: 600, color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.customer?.name}>
                        {r.customer?.name || '—'}
                      </div>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                        Cte PS: <span style={{ fontFamily: 'monospace' }}>{r.customer?.number}</span> · Vend: {r.rep?.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>
                        {r.paymentType} · {r.orderType}
                      </div>
                    </td>

                    {/* Col 3: Total PS */}
                    <td style={{ padding: '10px 10px', verticalAlign: 'top', fontFamily: 'monospace' }}>
                      <div style={{ fontWeight: 700, color: '#f3f4f6', fontSize: 13 }}>
                        {fmtMoney(r.totalAmount)}
                      </div>
                      <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>
                        Cant: {r.totalQty} · {String(r.currency || 'MXN').split('|')[0]}
                      </div>
                    </td>

                    {/* Col 4: Estatus en PowerSales */}
                    <td style={{ padding: '10px 10px', verticalAlign: 'top' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '3px 9px',
                        borderRadius: 6,
                        fontSize: 11.5,
                        fontWeight: 700,
                        background: psBadge.bg,
                        color: psBadge.color,
                        border: `1px solid ${psBadge.border}`,
                      }}>
                        {psBadge.label}
                      </span>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                        Esperado: <span style={{ color: '#d1d5db' }}>{psBadge.sub}</span>
                      </div>
                    </td>

                    {/* Col 5: Estado en Magic (cbpedvta / cbcot) */}
                    <td style={{ padding: '10px 10px', verticalAlign: 'top' }}>
                      {!r.magic?.reachable ? (
                        <span style={{ color: '#9ca3af', fontSize: 11.5 }}>⚠️ Sin conexión a Magic</span>
                      ) : (!ped && !cot) ? (
                        <div>
                          <span style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: 6,
                            fontSize: 11.5,
                            fontWeight: 700,
                            background: 'rgba(239, 68, 68, 0.14)',
                            color: '#f87171',
                          }}>
                            ❌ No existe en Magic
                          </span>
                          <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 3 }}>
                            Ni en cbpedvta ni en cbcot
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          {ped && (
                            <div style={{
                              padding: '4px 8px',
                              borderRadius: 6,
                              background: 'rgba(16, 185, 129, 0.1)',
                              border: '1px solid #065f46',
                            }}>
                              <div style={{ fontWeight: 700, color: '#34d399', fontSize: 11.5 }}>
                                📦 cbpedvta #{ped.No_Pedido}
                              </div>
                              <div style={{ fontSize: 11, color: '#d1d5db', marginTop: 1 }}>
                                Estatus: <b>{ped.Estatus_Pedido || '—'}</b> · Dist: <b>{ped.Distribuido ?? '—'}</b>
                                {ped.partidas !== null ? ` · ${ped.partidas} part.` : ''}
                              </div>
                              <div style={{ fontSize: 10.5, color: '#9ca3af', fontFamily: 'monospace' }}>
                                Total Magic: {fmtMoney(ped.Total)}
                                {ped.IDMetodoPagoSAT ? ` · SAT: ${ped.IDMetodoPagoSAT}/${ped.IDFormaPagoSAT || ''}` : ''}
                              </div>
                            </div>
                          )}
                          {cot && (
                            <div style={{
                              padding: '4px 8px',
                              borderRadius: 6,
                              background: 'rgba(167, 139, 250, 0.1)',
                              border: '1px solid #5b21b6',
                            }}>
                              <div style={{ fontWeight: 700, color: '#c4b5fd', fontSize: 11.5 }}>
                                📝 cbcot #{cot.No_Cotiza}
                              </div>
                              <div style={{ fontSize: 10.5, color: '#d1d5db', fontFamily: 'monospace' }}>
                                Total: {fmtMoney(cot.Total)} · Sync: {cot.Sync ?? '—'}
                                {cot.partidas !== null ? ` · ${cot.partidas} part.` : ''}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Col 6: Cola / Webhook */}
                    <td style={{ padding: '10px 10px', verticalAlign: 'top', fontSize: 11.5 }}>
                      {!mWh ? (
                        <span style={{ color: '#6b7280' }}>Sin webhook en Maestro</span>
                      ) : (
                        <div>
                          <div style={{ color: '#d1d5db', fontWeight: 600 }}>
                            WH Maestro #{mWh.id}{' '}
                            {r.webhook?.isPendingPull ? (
                              <span style={{
                                padding: '1px 6px',
                                borderRadius: 6,
                                fontSize: 10.5,
                                background: '#431407',
                                color: '#fb923c',
                                fontWeight: 700,
                              }}>
                                ⏳ Pendiente Pull
                              </span>
                            ) : (
                              <span style={{
                                padding: '1px 6px',
                                borderRadius: 6,
                                fontSize: 10.5,
                                background: '#064e3b',
                                color: '#34d399',
                              }}>
                                ✓ Jalado
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>
                            Últ. WH St: {mWh.lastPsStatusId ?? '—'} · {fmtDateShort(mWh.fecha_recepcion)}
                          </div>
                          {bWh && (
                            <div style={{
                              fontSize: 10.5,
                              marginTop: 2,
                              color: bWh.estado === 2 ? '#f87171' : '#34d399',
                              maxWidth: 180,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }} title={bWh.error_msg || ''}>
                              Sucursal: {bWh.estado === 2 ? `✗ ${bWh.error_msg}` : '✓ Aplicado'}
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Col 7: Diagnóstico */}
                    <td style={{ padding: '10px 10px', verticalAlign: 'top', maxWidth: 230 }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '3px 9px',
                        borderRadius: 6,
                        fontSize: 11.5,
                        fontWeight: 700,
                        background: diagBadge.bg,
                        color: diagBadge.color,
                        border: `1px solid ${diagBadge.border}`,
                      }}>
                        {diagBadge.icon} {r.diagnosis?.label}
                      </span>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4, lineHeight: 1.35 }}>
                        {r.diagnosis?.detail}
                      </div>
                    </td>

                    {/* Col 8: Acciones */}
                    <td style={{ padding: '10px 10px', verticalAlign: 'top', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => setSelectedOrder(r)}
                          style={{
                            padding: '5px 9px',
                            borderRadius: 6,
                            border: '1px solid #374151',
                            background: '#1f2937',
                            color: '#d1d5db',
                            fontSize: 11.5,
                            cursor: 'pointer',
                          }}
                        >
                          Ver Detalle
                        </button>

                        <button
                          disabled={isResyncing}
                          onClick={() => handleResyncOrders([r.orderNumber])}
                          title="Encolar desde GET /orders de PowerSales hacia la sucursal para insertar/actualizar en Magic"
                          style={{
                            padding: '5px 10px',
                            borderRadius: 6,
                            border: `1px solid ${r.diagnosis?.needsAction ? '#0284c7' : '#374151'}`,
                            background: r.diagnosis?.needsAction ? '#0369a1' : '#111827',
                            color: r.diagnosis?.needsAction ? '#e0f2fe' : '#9ca3af',
                            fontSize: 11.5,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {isResyncing ? 'Enviando…' : '⚡ Sincronizar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal de Detalle Comparativo */}
      {selectedOrder && (
        <Modal
          title={`Comparativa Pedido ${selectedOrder.orderNumber} (PS #${selectedOrder.psId})`}
          onClose={() => setSelectedOrder(null)}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div style={{ padding: 12, background: '#111827', borderRadius: 8, border: '1px solid #1f2937' }}>
              <div style={{ fontWeight: 700, color: '#38bdf8', marginBottom: 8, fontSize: 13 }}>
                ☁️ Estado en PowerSales (GET /orders)
              </div>
              <ModalField label="OrderNumber" value={selectedOrder.orderNumber} />
              <ModalField label="ID Interno PS" value={selectedOrder.psId} />
              <ModalField label="Estatus PS" value={`${selectedOrder.statusId} — ${selectedOrder.statusName}`} />
              <ModalField label="Sucursal (BranchId)" value={`${selectedOrder.branchId} (${selectedOrder.warehouseName})`} />
              <ModalField label="Cliente" value={`${selectedOrder.customer?.number} — ${selectedOrder.customer?.name}`} />
              <ModalField label="Total / Renglones" value={`${fmtMoney(selectedOrder.totalAmount)} (${selectedOrder.itemsCount} partidas)`} />
              <ModalField label="Pago / Tipo" value={`${selectedOrder.paymentType} / ${selectedOrder.orderType}`} />
              <ModalField label="Fecha Modificación" value={selectedOrder.modifiedDate || selectedOrder.createdDate} />
            </div>

            <div style={{ padding: 12, background: '#111827', borderRadius: 8, border: '1px solid #1f2937' }}>
              <div style={{ fontWeight: 700, color: '#34d399', marginBottom: 8, fontSize: 13 }}>
                🏢 Estado en Magic ERP (Sucursal {selectedOrder.branchId})
              </div>
              {selectedOrder.magic?.pedido ? (
                <>
                  <ModalField label="No_Pedido (cbpedvta)" value={`#${selectedOrder.magic.pedido.No_Pedido}`} />
                  <ModalField label="IDPs en cbpedvta" value={selectedOrder.magic.pedido.IDPs} />
                  <ModalField label="Estatus_Pedido" value={selectedOrder.magic.pedido.Estatus_Pedido || '—'} />
                  <ModalField label="Distribuido" value={String(selectedOrder.magic.pedido.Distribuido ?? '—')} />
                  <ModalField label="Total en cbpedvta" value={fmtMoney(selectedOrder.magic.pedido.Total)} />
                  <ModalField label="Partidas en dtpedvta" value={selectedOrder.magic.pedido.partidas ?? '—'} />
                  <ModalField
                    label="Campos SAT"
                    value={
                      selectedOrder.magic.pedido.IDMetodoPagoSAT
                        ? `${selectedOrder.magic.pedido.IDMetodoPagoSAT} / ${selectedOrder.magic.pedido.IDFormaPagoSAT || '—'} / ${selectedOrder.magic.pedido.IDUsoCFDISAT || '—'}`
                        : 'Sin datos SAT'
                    }
                  />
                </>
              ) : (
                <div style={{ color: '#f87171', fontSize: 12, marginBottom: 10 }}>
                  ❌ No tiene registro en <code>cbpedvta</code>
                </div>
              )}

              {selectedOrder.magic?.cotizacion ? (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #1f2937' }}>
                  <ModalField label="No_Cotiza (cbcot)" value={`#${selectedOrder.magic.cotizacion.No_Cotiza}`} />
                  <ModalField label="Total en cbcot" value={fmtMoney(selectedOrder.magic.cotizacion.Total)} />
                  <ModalField label="Partidas en dtcot" value={selectedOrder.magic.cotizacion.partidas ?? '—'} />
                </div>
              ) : (
                <div style={{ color: '#9ca3af', fontSize: 12 }}>
                  • Sin registro en <code>cbcot</code>
                </div>
              )}
            </div>
          </div>

          <div style={{ padding: 12, background: '#111827', borderRadius: 8, border: '1px solid #1f2937' }}>
            <div style={{ fontWeight: 700, color: '#fb923c', marginBottom: 6, fontSize: 13 }}>
              📋 Diagnóstico de Sincronización
            </div>
            <div style={{ fontSize: 12.5, color: '#e5e7eb', marginBottom: 6 }}>
              <b>{selectedOrder.diagnosis?.label}:</b> {selectedOrder.diagnosis?.detail}
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>
              Estado esperado en Magic: <b>{selectedOrder.diagnosis?.expectedLabel}</b>
            </div>
            {selectedOrder.webhook?.branch?.error_msg && (
              <div style={{ fontSize: 12, color: '#38bdf8', marginTop: 6 }}>
                Último mensaje en log de Sucursal: <code>{selectedOrder.webhook.branch.error_msg}</code>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

