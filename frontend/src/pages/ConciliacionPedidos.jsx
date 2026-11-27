import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import KpiCard from '../components/KpiCard.jsx';
import Modal, { ModalField } from '../components/Modal.jsx';

/**
 * Badges de estatus de PowerSales.
 * IMPORTANTE: Ningún estatus de negocio usa color ROJO aquí; el rojo se reserva 100% para errores de sincronización.
 */
function getPsStatusBadge(statusId, statusName = '') {
  const sId = Number(statusId);
  const sName = String(statusName || '').toUpperCase().trim();

  if (sId === 11) {
    return {
      label: `St 11 · ${sName || 'QUOTATION'}`,
      ruleNote: 'Debe existir en cbcot (Normal que NO esté en cbpedvta)',
      bg: 'rgba(167, 139, 250, 0.16)',
      color: '#c4b5fd',
      border: '#6d28d9',
    };
  }
  if (sId === 41) {
    return {
      label: `St 41 · ${sName || 'ORDER_CREATED'}`,
      ruleNote: 'Debe existir en cbpedvta (Pedido) y cbcot',
      bg: 'rgba(56, 189, 248, 0.16)',
      color: '#38bdf8',
      border: '#0284c7',
    };
  }
  if (sId === 38 || sId === 42) {
    return {
      label: `St ${sId} · ${sName || 'LIBERADO'}`,
      ruleNote: 'Debe existir en cbpedvta (Distribuido = 1)',
      bg: 'rgba(16, 185, 129, 0.15)',
      color: '#34d399',
      border: '#059669',
    };
  }
  if (sId === 43 || sId === 6) {
    return {
      label: `St ${sId} · ${sName || 'PICKED'}`,
      ruleNote: sId === 43 ? 'Debe existir en cbpedvta (Surtido Completo)' : 'Debe existir en cbpedvta (Surtido Parcial)',
      bg: 'rgba(20, 184, 166, 0.16)',
      color: '#2dd4bf',
      border: '#0d9488',
    };
  }
  if (sId === 7 || sName === 'INVOICED') {
    return {
      label: `St 7 · ${sName || 'INVOICED'}`,
      ruleNote: 'Debe existir en cbpedvta con Datos SAT',
      bg: 'rgba(56, 189, 248, 0.16)',
      color: '#7dd3fc',
      border: '#0369a1',
    };
  }
  if (sId === 8 || sName.includes('CANCEL')) {
    return {
      label: `St 8 · ${sName || 'CANCELLED'}`,
      ruleNote: 'Cancelado en PS (Si existe en cbpedvta debe tener Estatus = C)',
      bg: 'rgba(148, 163, 184, 0.16)',
      color: '#cbd5e1',
      border: '#475569',
    };
  }
  return {
    label: `St ${sId} · ${sName || 'DRAFT'}`,
    ruleNote: 'Normal que NO esté en Magic (Etapa previa / Borrador en PS)',
    bg: 'rgba(148, 163, 184, 0.12)',
    color: '#94a3b8',
    border: '#334155',
  };
}

/**
 * Colores de Diagnóstico:
 * ROJO = ÚNICAMENTE cuando diag.isError === true (ERROR_MISSING o ERROR_MISMATCH)
 */
function getDiagnosisStyle(diag) {
  if (!diag) return { bg: '#1e293b', color: '#94a3b8', border: '#334155', icon: '•' };
  if (diag.isError) {
    return {
      bg: 'rgba(239, 68, 68, 0.18)',
      color: '#f87171',
      border: '#dc2626',
      icon: '❌',
    };
  }
  switch (diag.code) {
    case 'SYNC_OK':
      return {
        bg: 'rgba(16, 185, 129, 0.15)',
        color: '#34d399',
        border: '#059669',
        icon: '✅',
      };
    case 'NORMAL_OMITTED':
      return {
        bg: 'rgba(148, 163, 184, 0.13)',
        color: '#cbd5e1',
        border: '#475569',
        icon: '⚪',
      };
    case 'PENDING_QUEUE':
      return {
        bg: 'rgba(251, 146, 60, 0.16)',
        color: '#fb923c',
        border: '#c2410c',
        icon: '⏳',
      };
    default:
      return {
        bg: 'rgba(148, 163, 184, 0.12)',
        color: '#94a3b8',
        border: '#334155',
        icon: '•',
      };
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
          msg: `${data.message}${data.triggeredBranches?.length ? ` · Poll ejecutado en Sucursal(es): ${data.triggeredBranches.join(', ')}` : ''}`,
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

  const availablePsStatuses = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.statusId)) {
        map.set(r.statusId, r.statusName);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      if (diagFilter !== 'ALL') {
        if (diagFilter === 'ONLY_ERRORS') {
          if (!r.diagnosis?.isError) return false;
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

  const errorOrdersList = useMemo(() => {
    return filteredRows
      .filter(r => r.diagnosis?.isError)
      .map(r => r.orderNumber);
  }, [filteredRows]);

  return (
    <div>
      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 className="section-title" style={{ margin: 0 }}>🔍 Conciliación de Pedidos (PowerSales ↔ Magic)</h1>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
            Verifica qué pedidos de PowerSales ya deben existir en Magic (<code style={{ color: '#34d399' }}>cbpedvta</code> / <code style={{ color: '#c4b5fd' }}>cbcot</code>), en cuáles es normal que aún no estén en Magic, y marca en <b style={{ color: '#f87171' }}>rojo únicamente los errores reales</b>.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {errorOrdersList.length > 0 && (
            <button
              className="btn"
              disabled={bulkResyncing || loading}
              onClick={() => handleResyncOrders(errorOrdersList)}
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
                ? 'Corrigiendo errores…'
                : `⚡ Re-sincronizar Pedidos con Error (${errorOrdersList.length})`}
            </button>
          )}

          <button
            className="btn btn--primary"
            disabled={loading}
            onClick={fetchReconciliation}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            {loading ? 'Verificando PS & Magic…' : '🔄 Actualizar Conciliación'}
          </button>
        </div>
      </div>

      {/* Guía clara de Reglas de Negocio: Cuándo es Normal vs Cuándo debe existir en Magic */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
        gap: 10,
        marginBottom: 16,
        padding: '10px 14px',
        background: '#111827',
        border: '1px solid #1f2937',
        borderRadius: 10,
        fontSize: 11.5,
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 14 }}>⚪</span>
          <div>
            <div style={{ fontWeight: 700, color: '#cbd5e1' }}>Normal que NO esté en Magic</div>
            <div style={{ color: '#9ca3af', marginTop: 2 }}>
              <b>St 1 (DRAFT)</b>, <b>St 3</b>, <b>St 35..37</b> o <b>St 8 (Cancelado antes de ser pedido)</b>: están en borrador en PS y no deben crearse en <code>cbpedvta</code>.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 14 }}>🟣</span>
          <div>
            <div style={{ fontWeight: 700, color: '#c4b5fd' }}>Sólo en Cotización (cbcot)</div>
            <div style={{ color: '#9ca3af', marginTop: 2 }}>
              <b>St 11 (QUOTATION)</b>: Debe existir en <code>cbcot</code> (<code>No_Cotiza</code>). Es <b>normal</b> que aún NO exista en <code>cbpedvta</code>.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 14 }}>✅</span>
          <div>
            <div style={{ fontWeight: 700, color: '#34d399' }}>Debe existir en Magic (cbpedvta) y PS</div>
            <div style={{ color: '#9ca3af', marginTop: 2 }}>
              <b>St 41</b> (Pedido Dist=0/1), <b>St 38 / 42</b> (Liberado Dist=1), <b>St 43 / 6</b> (Surtido), <b>St 7</b> (Facturado SAT) y <b>St 8</b> (si ya era pedido → <code>Estatus=C</code>).
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 14 }}>❌</span>
          <div>
            <div style={{ fontWeight: 700, color: '#f87171' }}>Rojo = Únicamente Errores</div>
            <div style={{ color: '#9ca3af', marginTop: 2 }}>
              Sólo se marca en <b style={{ color: '#f87171' }}>rojo</b> si por su estatus <b>ya debía existir en Magic y falta</b>, si su estatus en Magic está desfasado o si dio error SQL.
            </div>
          </div>
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
                padding: '7px 14px',
                background: '#111827',
                borderRadius: 8,
                border: `1px solid ${b.magicReachable ? '#065f46' : '#374151'}`,
                fontSize: 12,
              }}
            >
              <span style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: b.magicReachable ? '#34d399' : '#9ca3af',
                boxShadow: b.magicReachable ? '0 0 6px #34d399' : 'none',
              }} />
              <span style={{ fontWeight: 700, color: '#f3f4f6' }}>Sucursal {b.branch_id}</span>
              <span style={{ color: '#9ca3af' }}>({b.hostname})</span>
              <span style={{
                padding: '1px 7px',
                borderRadius: 6,
                fontSize: 11,
                background: b.magicReachable ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                color: b.magicReachable ? '#34d399' : '#9ca3af',
                fontWeight: 600,
              }}>
                {b.magicReachable
                  ? (b.magicSource === 'branch_ws' ? 'Magic Conectado (Túnel WS)' : 'Magic Conectado (BD Directa)')
                  : 'Magic Sin Conexión WS'}
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

      {/* KPIs: El rojo sólo se usa si hay errores reales */}
      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        <div onClick={() => setDiagFilter('ALL')} style={{ cursor: 'pointer' }}>
          <KpiCard
            label="Total Pedidos Evaluados"
            value={summary?.totalOrders ?? '—'}
            sub="API GET /orders + Webhooks PS"
            variant="cyan"
            delay={0}
          />
        </div>
        <div onClick={() => setDiagFilter('SYNC_OK')} style={{ cursor: 'pointer' }}>
          <KpiCard
            label="Sincronizados en Magic"
            value={summary?.syncOk ?? '—'}
            sub="existen en cbpedvta / cbcot OK"
            variant="green"
            delay={60}
          />
        </div>
        <div onClick={() => setDiagFilter('NORMAL_OMITTED')} style={{ cursor: 'pointer' }}>
          <KpiCard
            label="Normal: No aplican en Magic"
            value={summary?.normalOmitted ?? '—'}
            sub="en Borrador PS (St 1) / sin pedido"
            variant="cyan"
            delay={120}
          />
        </div>
        <div onClick={() => setDiagFilter('PENDING_QUEUE')} style={{ cursor: 'pointer' }}>
          <KpiCard
            label="Pendientes en Cola"
            value={summary?.pendingQueue ?? '—'}
            sub="esperando pull de sucursal"
            variant="orange"
            delay={180}
          />
        </div>
        <div onClick={() => setDiagFilter('ONLY_ERRORS')} style={{ cursor: 'pointer' }}>
          <KpiCard
            label="Errores de Sincronización"
            value={summary?.totalErrors ?? 0}
            sub={
              (summary?.totalErrors || 0) > 0
                ? `${summary?.errorMissing || 0} faltante(s) · ${summary?.errorMismatch || 0} desfasado(s)`
                : '0 fallas detectadas'
            }
            variant={(summary?.totalErrors || 0) > 0 ? 'red' : 'green'}
            delay={240}
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
          <option value="ALL">Estado: Todos ({rows.length})</option>
          <option value="ONLY_ERRORS">❌ Solo Errores Reales ({summary?.totalErrors || 0})</option>
          <option value="ERROR_MISSING">❌ Error: Debía estar en Magic y Falta ({summary?.errorMissing || 0})</option>
          <option value="ERROR_MISMATCH">❌ Error: Estatus Desfasado / Error DB ({summary?.errorMismatch || 0})</option>
          <option value="PENDING_QUEUE">⏳ Pendientes en Cola por Jalar ({summary?.pendingQueue || 0})</option>
          <option value="SYNC_OK">✅ Sincronizados en Magic OK ({summary?.syncOk || 0})</option>
          <option value="NORMAL_OMITTED">⚪ Normal: No deben estar en Magic aún ({summary?.normalOmitted || 0})</option>
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
            Consultando pedidos en PowerSales y verificando tablas <code style={{ color: '#34d399' }}>cbpedvta</code> / <code style={{ color: '#c4b5fd' }}>cbcot</code> en Magic…
          </div>
        ) : filteredRows.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center', color: '#6b7280' }}>
            No se encontraron pedidos con los filtros seleccionados.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: '#9ca3af', borderBottom: '1px solid #374151', textAlign: 'left' }}>
                <th style={{ padding: '10px 10px' }}>Pedido PowerSales</th>
                <th style={{ padding: '10px 10px' }}>Cliente / Vendedor</th>
                <th style={{ padding: '10px 10px' }}>Total</th>
                <th style={{ padding: '10px 10px' }}>Estatus Actual en PowerSales y Regla</th>
                <th style={{ padding: '10px 10px' }}>Existencia Actual en Magic (cbpedvta / cbcot)</th>
                <th style={{ padding: '10px 10px' }}>Estado del Webhook</th>
                <th style={{ padding: '10px 10px' }}>Diagnóstico</th>
                <th style={{ padding: '10px 10px', textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(r => {
                const psBadge = getPsStatusBadge(r.statusId, r.statusName);
                const diagStyle = getDiagnosisStyle(r.diagnosis);
                const isError = Boolean(r.diagnosis?.isError);
                const ped = r.magic?.pedido;
                const cot = r.magic?.cotizacion;
                const mWh = r.webhook?.master;
                const bWh = r.webhook?.branch;
                const isResyncing = Boolean(resyncingMap[r.orderNumber]);

                return (
                  <tr
                    key={`${r.orderNumber}-${r.psId}`}
                    style={{
                      borderBottom: '1px solid #1f2937',
                      // Solo las filas con ERROR real tienen fondo rojizo
                      background: isError ? 'rgba(239, 68, 68, 0.07)' : 'transparent',
                    }}
                  >
                    {/* Col 1: Folio PS */}
                    <td style={{ padding: '10px 10px', verticalAlign: 'top' }}>
                      <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: '#f3f4f6' }}>
                        {r.orderNumber}
                      </div>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                        {r.psId ? <>ID PS: <span style={{ color: '#d1d5db' }}>#{r.psId}</span> · </> : null}
                        Sucursal: <span style={{ color: '#38bdf8', fontWeight: 600 }}>{r.branchId}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>
                        📅 {r.orderDate || fmtDateShort(r.createdDate)}
                        {r.itemsCount > 0 ? ` · ${r.itemsCount} part.` : ''}
                      </div>
                    </td>

                    {/* Col 2: Cliente / Vendedor */}
                    <td style={{ padding: '10px 10px', verticalAlign: 'top', maxWidth: 210 }}>
                      <div style={{ fontWeight: 600, color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.customer?.name}>
                        {r.customer?.name || '—'}
                      </div>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                        Cte: <span style={{ fontFamily: 'monospace' }}>{r.customer?.number}</span> · Vend: {r.rep?.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>
                        {r.paymentType} · {r.orderType}
                      </div>
                    </td>

                    {/* Col 3: Total */}
                    <td style={{ padding: '10px 10px', verticalAlign: 'top', fontFamily: 'monospace' }}>
                      <div style={{ fontWeight: 700, color: '#f3f4f6', fontSize: 13 }}>
                        {fmtMoney(r.totalAmount || ped?.Total || cot?.Total || 0)}
                      </div>
                      <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>
                        {String(r.currency || 'MXN').split('|')[0]}
                      </div>
                    </td>

                    {/* Col 4: Estatus en PowerSales y Regla de Negocio */}
                    <td style={{ padding: '10px 10px', verticalAlign: 'top', maxWidth: 240 }}>
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
                      {Array.isArray(r.statusHistory) && r.statusHistory.length > 1 && (
                        <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 3, fontFamily: 'monospace' }}>
                          Ruta PS: {r.statusHistory.join(' → ')}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3, lineHeight: 1.3 }}>
                        {r.diagnosis?.ruleTitle || psBadge.ruleNote}
                      </div>
                    </td>

                    {/* Col 5: Existencia Actual en Magic (cbpedvta / cbcot) — ROJO SOLO SI ES ERROR */}
                    <td style={{ padding: '10px 10px', verticalAlign: 'top' }}>
                      {!r.magic?.reachable ? (
                        <span style={{ color: '#9ca3af', fontSize: 11.5 }}>⚠️ Sucursal sin conexión WS</span>
                      ) : (!ped && !cot) ? (
                        isError ? (
                          /* ROJO: Porque YA DEBERÍA existir en Magic según su estatus y NO está */
                          <div>
                            <span style={{
                              display: 'inline-block',
                              padding: '3px 8px',
                              borderRadius: 6,
                              fontSize: 11.5,
                              fontWeight: 700,
                              background: 'rgba(239, 68, 68, 0.18)',
                              color: '#f87171',
                              border: '1px solid #dc2626',
                            }}>
                              ❌ Falta en Magic
                            </span>
                            <div style={{ fontSize: 10.5, color: '#fca5a5', marginTop: 3 }}>
                              Debía existir y no está en cbpedvta/cbcot
                            </div>
                          </div>
                        ) : r.diagnosis?.code === 'PENDING_QUEUE' ? (
                          /* ÁMBAR: Aún está en cola por jalar */
                          <div>
                            <span style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: 6,
                              fontSize: 11.5,
                              fontWeight: 600,
                              background: 'rgba(251, 146, 60, 0.16)',
                              color: '#fb923c',
                              border: '1px solid #c2410c',
                            }}>
                              ⏳ Por insertar (En cola)
                            </span>
                          </div>
                        ) : (
                          /* GRIS NEUTRO: Porque es NORMAL que NO exista en Magic (ej. St 1 DRAFT o St 8 sin pedido) */
                          <div>
                            <span style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: 6,
                              fontSize: 11.5,
                              fontWeight: 600,
                              background: 'rgba(148, 163, 184, 0.13)',
                              color: '#cbd5e1',
                              border: '1px solid #475569',
                            }}>
                              ⚪ No está en Magic (Normal)
                            </span>
                            <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 3 }}>
                              {Number(r.statusId) === 8
                                ? 'Cancelado en PS antes de ser pedido'
                                : `En St ${r.statusId} (${r.statusName}) aún no pasa a Magic`}
                            </div>
                          </div>
                        )
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          {ped ? (
                            <div style={{
                              padding: '4px 8px',
                              borderRadius: 6,
                              background: isError ? 'rgba(239, 68, 68, 0.14)' : 'rgba(16, 185, 129, 0.1)',
                              border: `1px solid ${isError ? '#dc2626' : '#065f46'}`,
                            }}>
                              <div style={{ fontWeight: 700, color: isError ? '#f87171' : '#34d399', fontSize: 11.5 }}>
                                📦 cbpedvta #{ped.No_Pedido}
                              </div>
                              <div style={{ fontSize: 11, color: '#d1d5db', marginTop: 1 }}>
                                Estatus Magic: <b>{ped.Estatus_Pedido || '—'}</b> · Dist: <b>{ped.Distribuido ?? '—'}</b>
                                {ped.partidas !== null ? ` · ${ped.partidas} part.` : ''}
                              </div>
                              <div style={{ fontSize: 10.5, color: '#9ca3af', fontFamily: 'monospace' }}>
                                Total: {fmtMoney(ped.Total)}
                                {ped.IDMetodoPagoSAT ? ` · SAT: ${ped.IDMetodoPagoSAT}/${ped.IDFormaPagoSAT || ''}` : ''}
                              </div>
                            </div>
                          ) : isError ? (
                            /* Tiene cotización en cbcot pero YA DEBERÍA tener pedido en cbpedvta y le falta */
                            <div style={{
                              padding: '4px 8px',
                              borderRadius: 6,
                              background: 'rgba(239, 68, 68, 0.16)',
                              border: '1px solid #dc2626',
                            }}>
                              <div style={{ fontWeight: 700, color: '#f87171', fontSize: 11.5 }}>
                                ❌ Falta en cbpedvta
                              </div>
                              <div style={{ fontSize: 10.5, color: '#fca5a5' }}>
                                En St {r.statusId} ya debe tener No_Pedido
                              </div>
                            </div>
                          ) : null}

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

                          {!ped && cot && Number(r.statusId) === 11 && (
                            <div style={{ fontSize: 10.5, color: '#9ca3af' }}>
                              ✓ Normal que no esté en cbpedvta (es St 11)
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Col 6: Estado del Webhook */}
                    <td style={{ padding: '10px 10px', verticalAlign: 'top', fontSize: 11.5 }}>
                      {!mWh ? (
                        <span style={{ color: '#9ca3af' }}>
                          API GET /orders<br />
                          <span style={{ fontSize: 10.5, color: '#6b7280' }}>(Aún sin webhook emitido)</span>
                        </span>
                      ) : (
                        <div>
                          <div style={{ color: '#d1d5db', fontWeight: 600 }}>
                            WH #{mWh.id}{' '}
                            {r.webhook?.isPendingPull ? (
                              <span style={{
                                padding: '1px 6px',
                                borderRadius: 6,
                                fontSize: 10.5,
                                background: '#431407',
                                color: '#fb923c',
                                fontWeight: 700,
                              }}>
                                ⏳ En Cola
                              </span>
                            ) : (
                              <span style={{
                                padding: '1px 6px',
                                borderRadius: 6,
                                fontSize: 10.5,
                                background: '#064e3b',
                                color: '#34d399',
                              }}>
                                ✓ Jalado ({mWh.count} ev.)
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>
                            {fmtDateShort(mWh.fecha_recepcion)}
                          </div>
                          {bWh && (
                            <div
                              style={{
                                fontSize: 10.5,
                                marginTop: 2,
                                color: Number(bWh.estado) === 2 ? '#f87171' : '#9ca3af',
                                fontWeight: Number(bWh.estado) === 2 ? 700 : 400,
                                maxWidth: 185,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={bWh.error_msg || ''}
                            >
                              {Number(bWh.estado) === 2 ? `❌ ${bWh.error_msg}` : `✓ ${bWh.error_msg || 'Procesado OK'}`}
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Col 7: Diagnóstico — ROJO SOLO SI isError === true */}
                    <td style={{ padding: '10px 10px', verticalAlign: 'top', maxWidth: 250 }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '3px 9px',
                        borderRadius: 6,
                        fontSize: 11.5,
                        fontWeight: 700,
                        background: diagStyle.bg,
                        color: diagStyle.color,
                        border: `1px solid ${diagStyle.border}`,
                      }}>
                        {diagStyle.icon} {r.diagnosis?.label}
                      </span>
                      <div style={{
                        fontSize: 11,
                        color: isError ? '#fca5a5' : '#9ca3af',
                        marginTop: 4,
                        lineHeight: 1.35,
                      }}>
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
                          Detalle
                        </button>

                        {(isError || r.diagnosis?.needsAction) && (
                          <button
                            disabled={isResyncing}
                            onClick={() => handleResyncOrders([r.orderNumber])}
                            title="Re-encolar hacia la sucursal para corregir en Magic"
                            style={{
                              padding: '5px 10px',
                              borderRadius: 6,
                              border: `1px solid ${isError ? '#dc2626' : '#0284c7'}`,
                              background: isError ? '#991b1b' : '#0369a1',
                              color: isError ? '#fecaca' : '#e0f2fe',
                              fontSize: 11.5,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {isResyncing ? 'Enviando…' : '⚡ Corregir / Sync'}
                          </button>
                        )}
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
          title={`Comparativa Pedido ${selectedOrder.orderNumber}`}
          onClose={() => setSelectedOrder(null)}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div style={{ padding: 12, background: '#111827', borderRadius: 8, border: '1px solid #1f2937' }}>
              <div style={{ fontWeight: 700, color: '#38bdf8', marginBottom: 8, fontSize: 13 }}>
                ☁️ Estado en PowerSales
              </div>
              <ModalField label="OrderNumber" value={selectedOrder.orderNumber} />
              <ModalField label="ID Interno PS" value={selectedOrder.psId ?? '—'} />
              <ModalField label="Estatus Actual PS" value={`${selectedOrder.statusId} — ${selectedOrder.statusName}`} />
              <ModalField label="Historial Estatus PS" value={Array.isArray(selectedOrder.statusHistory) ? selectedOrder.statusHistory.join(' → ') : String(selectedOrder.statusId)} />
              <ModalField label="Sucursal (BranchId)" value={`${selectedOrder.branchId} (${selectedOrder.warehouseName})`} />
              <ModalField label="Cliente" value={`${selectedOrder.customer?.number} — ${selectedOrder.customer?.name}`} />
              <ModalField label="Total / Partidas" value={`${fmtMoney(selectedOrder.totalAmount)} (${selectedOrder.itemsCount} partidas)`} />
              <ModalField label="Pago / Tipo" value={`${selectedOrder.paymentType} / ${selectedOrder.orderType}`} />
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
                <div style={{
                  color: selectedOrder.diagnosis?.isError ? '#f87171' : '#cbd5e1',
                  fontSize: 12,
                  marginBottom: 10,
                }}>
                  {selectedOrder.diagnosis?.isError
                    ? '❌ ERROR: Falta registro en cbpedvta'
                    : '⚪ Normal: Sin registro en cbpedvta para este estatus'}
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

          <div style={{
            padding: 12,
            background: '#111827',
            borderRadius: 8,
            border: `1px solid ${selectedOrder.diagnosis?.isError ? '#dc2626' : '#1f2937'}`,
          }}>
            <div style={{
              fontWeight: 700,
              color: selectedOrder.diagnosis?.isError ? '#f87171' : '#34d399',
              marginBottom: 6,
              fontSize: 13,
            }}>
              📋 Regla y Diagnóstico
            </div>
            <div style={{ fontSize: 12.5, color: '#e5e7eb', marginBottom: 6 }}>
              <b>{selectedOrder.diagnosis?.label}:</b> {selectedOrder.diagnosis?.detail}
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>
              Regla aplicada: <b>{selectedOrder.diagnosis?.ruleTitle}</b> — {selectedOrder.diagnosis?.ruleDescription}
            </div>
            {selectedOrder.webhook?.branch?.error_msg && (
              <div style={{
                fontSize: 12,
                color: Number(selectedOrder.webhook.branch.estado) === 2 ? '#f87171' : '#38bdf8',
                marginTop: 6,
              }}>
                Último log en Sucursal: <code>{selectedOrder.webhook.branch.error_msg}</code>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
