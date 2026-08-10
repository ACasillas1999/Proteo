import { useState, useEffect } from 'react';
import axios from 'axios';
import { useMode } from '../context/ModeContext.jsx';
import { Globe, Building2, Star } from 'lucide-react';

const TYPE_BADGE = {
  text:       { label: 'Texto',      color: '#22d3ee' },
  number:     { label: 'Número',     color: '#a78bfa' },
  boolean:    { label: 'Booleano',   color: '#34d399' },
  fixedId:    { label: 'ID fijo',    color: '#fb923c' },
  skuPrefix:  { label: 'Prefijo SKU', color: '#f472b6' },
  categoryId: { label: 'Categoría',  color: '#fbbf24' },
  fixed:      { label: 'Sistema',    color: '#6b7280' },
  erpColumn:  { label: 'Columna ERP',color: '#38bdf8' },
  numStr:     { label: 'Núm. (Texto)',color: '#a78bfa' }
};

export default function Mapeo() {
  const { mode } = useMode();
  const [activeTab, setActiveTab] = useState('articulo');
  const [mapeo,   setMapeo]   = useState(null);
  const [dbRef,   setDbRef]   = useState({ host: '', name: '' });
  
  const [fieldsArt, setFieldsArt] = useState({ psFields: [], erpColumns: [], dbConnected: true });
  const [fieldsAlm, setFieldsAlm] = useState({ psFields: [], erpColumns: [], dbConnected: true });
  const [fieldsCli, setFieldsCli] = useState({ psFields: [], erpColumns: [], dbConnected: true });

  // Pedido y Cotización: la tabla ERP destino no está fija, el usuario la elige.
  const [pedPsFields, setPedPsFields] = useState({
    pedido_cabecera: [],
    pedido_detalle: [],
    cotizacion_cabecera: [],
    cotizacion_detalle: [],
  });
  const [tables,      setTables]      = useState([]);
  const [tablesOk,    setTablesOk]    = useState(true);
  const [pedidoCols,  setPedidoCols]  = useState({
    pedido_cabecera: [],
    pedido_detalle: [],
    cotizacion_cabecera: [],
    cotizacion_detalle: [],
  });

  const [loading, setLoading] = useState(true);
  const [saved,   setSaved]   = useState(false);
  const [filter,  setFilter]  = useState('');

  // Vista por sucursal (solo maestro)
  const [branches,      setBranches]      = useState([]);
  const [selectedBranch, setSelectedBranch] = useState(null); // null = global
  const [branchMapeo,   setBranchMapeo]   = useState(null);   // effective map por entidad

  // Cargar sucursales conocidas (solo maestro)
  useEffect(() => {
    if (mode !== 'master') return;
    axios.get('/api/branches/digest')
      .then(r => setBranches(r.data.data ?? []))
      .catch(() => {});
  }, [mode]);

  // Cargar mapeo efectivo cuando se selecciona una sucursal
  useEffect(() => {
    if (selectedBranch === null) { setBranchMapeo(null); return; }
    axios.get(`/api/mapeo/branch/${selectedBranch}`)
      .then(r => setBranchMapeo(r.data.data ?? null))
      .catch(() => setBranchMapeo(null));
  }, [selectedBranch]);

  useEffect(() => {
    Promise.all([
      axios.get('/api/mapeo'),
      axios.get('/api/mapeo/fields'),
      axios.get('/api/mapeo/fields/articuloalm'),
      axios.get('/api/mapeo/fields/cliente'),
      axios.get('/api/mapeo/fields/pedido_cabecera'),
      axios.get('/api/mapeo/fields/pedido_detalle'),
      axios.get('/api/mapeo/tables'),
    ]).then(([m, fArt, fAlm, fCli, fPedCab, fPedDet, tablesRes]) => {
      
      const setupFields = (fData, savedMap) => {
        const psFields = fData.psFields ?? [];
        const erpColumns = fData.erpColumns ?? [];
        const dbConnected = fData.dbConnected !== false;
        const fieldMap = savedMap ?? {};
        
        const initialFieldMap = {};
        for (const def of psFields) {
          if (def.type === 'fixed' || def.type === 'skuPrefix') continue;
          
          const saved = fieldMap[def.field];
          if (def.type === 'fixedId') {
            initialFieldMap[def.field] = saved !== undefined ? saved : (def.defaultFixed || '');
          } else {
            const valueToUse = saved !== undefined ? saved : (def.defaultErp || '');
            if (dbConnected) {
              const isValidErpCol = valueToUse !== '' && erpColumns.includes(String(valueToUse));
              initialFieldMap[def.field] = isValidErpCol ? valueToUse : '';
            } else {
              initialFieldMap[def.field] = valueToUse;
            }
          }
        }
        return { psFields, erpColumns, dbConnected, initialFieldMap };
      };

      const artData = setupFields(fArt.data, m.data.data?.articulo?.fieldMap);
      const almData = setupFields(fAlm.data, m.data.data?.articuloalm?.fieldMap);
      const cliData = setupFields(fCli.data, m.data.data?.cliente?.fieldMap);

      const pedCabTable = m.data.data?.pedido_cabecera?.table ?? '';
      const pedDetTable  = m.data.data?.pedido_detalle?.table ?? '';
      const cotCabTable = m.data.data?.cotizacion_cabecera?.table ?? '';
      const cotDetTable  = m.data.data?.cotizacion_detalle?.table ?? '';

      setMapeo({
        ...m.data.data,
        articulo: { ...m.data.data?.articulo, fieldMap: artData.initialFieldMap },
        articuloalm: { ...m.data.data?.articuloalm, fieldMap: almData.initialFieldMap },
        cliente: { ...m.data.data?.cliente, fieldMap: cliData.initialFieldMap },
        pedido_cabecera: { fieldMap: m.data.data?.pedido_cabecera?.fieldMap ?? {}, table: pedCabTable },
        pedido_detalle: { fieldMap: m.data.data?.pedido_detalle?.fieldMap ?? {}, table: pedDetTable },
        cotizacion_cabecera: { fieldMap: m.data.data?.cotizacion_cabecera?.fieldMap ?? {}, table: cotCabTable },
        cotizacion_detalle: { fieldMap: m.data.data?.cotizacion_detalle?.fieldMap ?? {}, table: cotDetTable },
      });

      setFieldsArt({ psFields: artData.psFields, erpColumns: artData.erpColumns, dbConnected: artData.dbConnected });
      setFieldsAlm({ psFields: almData.psFields, erpColumns: almData.erpColumns, dbConnected: almData.dbConnected });
      setFieldsCli({ psFields: cliData.psFields, erpColumns: cliData.erpColumns, dbConnected: cliData.dbConnected });

      setPedPsFields({
        pedido_cabecera: fPedCab.data.psFields ?? [],
        pedido_detalle: fPedDet.data.psFields ?? [],
        cotizacion_cabecera: fPedCab.data.psFields ?? [],
        cotizacion_detalle: fPedDet.data.psFields ?? [],
      });
      setTables(tablesRes.data.tables ?? []);
      setTablesOk(tablesRes.data.ok !== false);

      // Si ya había tabla elegida (guardada previamente), carga sus columnas de una vez
      const colFetches = [];
      if (pedCabTable) colFetches.push(
        axios.get(`/api/mapeo/columns/${encodeURIComponent(pedCabTable)}`)
          .then(r => setPedidoCols(p => ({ ...p, pedido_cabecera: r.data.columns ?? [] })))
          .catch(() => {})
      );
      if (pedDetTable) colFetches.push(
        axios.get(`/api/mapeo/columns/${encodeURIComponent(pedDetTable)}`)
          .then(r => setPedidoCols(p => ({ ...p, pedido_detalle: r.data.columns ?? [] })))
          .catch(() => {})
      );
      if (cotCabTable) colFetches.push(
        axios.get(`/api/mapeo/columns/${encodeURIComponent(cotCabTable)}`)
          .then(r => setPedidoCols(p => ({ ...p, cotizacion_cabecera: r.data.columns ?? [] })))
          .catch(() => {})
      );
      if (cotDetTable) colFetches.push(
        axios.get(`/api/mapeo/columns/${encodeURIComponent(cotDetTable)}`)
          .then(r => setPedidoCols(p => ({ ...p, cotizacion_detalle: r.data.columns ?? [] })))
          .catch(() => {})
      );
      Promise.all(colFetches);

      setDbRef({
        host: fArt.data.dbHost || 'localhost',
        name: fArt.data.dbName || ''
      });

    }).finally(() => setLoading(false));
  }, []);

  // Cambiar la tabla ERP elegida para cabecera/detalle de pedido — refresca sus columnas
  const setPedidoTable = (tab, tableName) => {
    setMapeo(p => ({ ...p, [tab]: { ...p[tab], table: tableName } }));
    if (!tableName) { setPedidoCols(p => ({ ...p, [tab]: [] })); return; }
    axios.get(`/api/mapeo/columns/${encodeURIComponent(tableName)}`)
      .then(r => setPedidoCols(p => ({ ...p, [tab]: r.data.columns ?? [] })))
      .catch(() => setPedidoCols(p => ({ ...p, [tab]: [] })));
  };

  const save = async () => {
    try { await axios.put('/api/mapeo', mapeo); setSaved(true); setTimeout(() => setSaved(false), 2500); }
    catch { /* ignore */ }
  };

  const setFieldMapVal = (tab, psField, val) => {
    const entityMap = { articulo: 'articulo', pricelists: 'articulo', articuloalm: 'articuloalm', cliente: 'cliente' };
    const targetEntity = entityMap[tab] ?? tab;
    setMapeo(p => ({
      ...p,
      [targetEntity]: { ...p[targetEntity], fieldMap: { ...p[targetEntity].fieldMap, [psField]: val } }
    }));
  };

  if (loading) return <p className="text-muted" style={{ padding: 32 }}>Cargando…</p>;
  if (!mapeo)  return <p className="text-muted" style={{ padding: 32 }}>Error al cargar.</p>;

  // Resolve which data/fields to show based on active tab
  const isPedidoTab = activeTab === 'pedido_cabecera' || activeTab === 'pedido_detalle' || activeTab === 'cotizacion_cabecera' || activeTab === 'cotizacion_detalle';
  const entityForTab = {
    articulo: 'articulo',
    pricelists: 'articulo',
    articuloalm: 'articuloalm',
    cliente: 'cliente',
    pedido_cabecera: 'pedido_cabecera',
    pedido_detalle: 'pedido_detalle',
    cotizacion_cabecera: 'cotizacion_cabecera',
    cotizacion_detalle: 'cotizacion_detalle'
  };
  const fieldsForTab = {
    articulo: fieldsArt,
    pricelists: fieldsArt,
    articuloalm: fieldsAlm,
    cliente: fieldsCli,
    pedido_cabecera: { psFields: pedPsFields.pedido_cabecera, erpColumns: pedidoCols.pedido_cabecera, dbConnected: tablesOk },
    pedido_detalle: { psFields: pedPsFields.pedido_detalle, erpColumns: pedidoCols.pedido_detalle, dbConnected: tablesOk },
    cotizacion_cabecera: { psFields: pedPsFields.cotizacion_cabecera, erpColumns: pedidoCols.cotizacion_cabecera, dbConnected: tablesOk },
    cotizacion_detalle: { psFields: pedPsFields.cotizacion_detalle, erpColumns: pedidoCols.cotizacion_detalle, dbConnected: tablesOk },
  };
  const currentData = mapeo[entityForTab[activeTab] ?? 'articulo'];
  const currentFields = fieldsForTab[activeTab] ?? fieldsArt;
  const fieldMap = currentData?.fieldMap ?? {};
  const dbConnected = currentFields.dbConnected !== false;
  const currentTable = currentData?.table ?? '';

  const psFields = Array.isArray(currentFields.psFields) ? currentFields.psFields : [];
  const erpCols  = currentFields.erpColumns ?? [];

  const visibleFields = psFields.filter(f => {
    // 1. Filtrar por pestaña
    if (activeTab === 'articulo' && f.type === 'priceList') return false;
    if (activeTab === 'pricelists' && f.type !== 'priceList') return false;

    // En maestro, BranchId no aplica — cada sucursal usa su .env
    if (mode === 'master' && f.field === 'BranchId') return false;

    // 2. Filtrar por texto
    if (filter) {
      const match = f.field.toLowerCase().includes(filter.toLowerCase()) ||
                    (f.label ?? '').toLowerCase().includes(filter.toLowerCase());
      if (!match) return false;
    }
    return true;
  });

  return (
    <div style={{ 
      display: 'flex', 
      gap: 0, 
      alignItems: 'stretch', 
      width: 'calc(100% + 48px)', 
      margin: '-24px -24px -24px -24px',
      minHeight: 'calc(100vh - 56px)',
      position: 'relative'
    }}>
      {/* Contenido Principal (Mapeo) */}
      <div style={{ flex: 1, minWidth: 0, padding: 24, marginRight: 240 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          <h1 className="section-title" style={{ margin: 0 }}>🗺️ Mapeo de Campos</h1>

          {/* Selector de sucursal — solo maestro */}
          {mode === 'master' && (
            <select
              value={selectedBranch ?? ''}
              onChange={e => setSelectedBranch(e.target.value === '' ? null : parseInt(e.target.value))}
              style={{ borderRadius: 'var(--radius)', minWidth: 180, fontWeight: 600 }}
            >
              <option value="">🌐 Global (editable)</option>
              {branches.map(b => (
                <option key={b.branch_id} value={b.branch_id}>
                  Sucursal {b.branch_id}{b.hostname ? ` — ${b.hostname}` : ''}
                </option>
              ))}
            </select>
          )}

          <input
            placeholder="🔍 Filtrar campos…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ flex: 1, minWidth: 180, maxWidth: 280, borderRadius: 'var(--radius)' }}
          />
          {/* Guardar solo en vista global */}
          {selectedBranch === null && (
            <button 
              className={`btn ${saved ? 'btn--green' : 'btn--cyan'}`} 
              onClick={save}
              disabled={!dbConnected}
              style={!dbConnected ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            >
              {saved ? '✓ Guardado' : '💾 Guardar mapeo'}
            </button>
          )}
          {selectedBranch !== null && (
            <span style={{ fontSize: 12, color: '#fb923c', fontWeight: 600 }}>
              Solo lectura — mapeo efectivo de sucursal {selectedBranch}
            </span>
          )}
        </div>

        {/* Alerta de Base de Datos Desconectada */}
        {!dbConnected && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#f87171',
            padding: '12px 16px',
            borderRadius: 'var(--radius)',
            marginBottom: 20,
            fontSize: 13,
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 10
          }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <span>
              <strong>Sin conexión a la Base de Datos del ERP (Principal):</strong> 
              Los mapeos guardados localmente se muestran en rojo y han sido bloqueados temporalmente para evitar modificaciones inconsistentes.
            </span>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 10, flexWrap: 'wrap' }}>
          <button 
            className={`btn ${activeTab === 'articulo' ? 'btn--cyan' : 'btn--outline'}`} 
            onClick={() => { setActiveTab('articulo'); setFilter(''); }}>
            📦 Artículos (productos)
          </button>
          <button 
            className={`btn ${activeTab === 'pricelists' ? 'btn--cyan' : 'btn--outline'}`} 
            onClick={() => { setActiveTab('pricelists'); setFilter(''); }}>
            💲 Listas de Precios
          </button>
          <button 
            className={`btn ${activeTab === 'articuloalm' ? 'btn--cyan' : 'btn--outline'}`} 
            onClick={() => { setActiveTab('articuloalm'); setFilter(''); }}>
            🏢 Inventario (articuloalm)
          </button>
          <button 
            className={`btn ${activeTab === 'cliente' ? 'btn--cyan' : 'btn--outline'}`} 
            onClick={() => { setActiveTab('cliente'); setFilter(''); }}>
            👥 Clientes (customers)
          </button>
          <button 
            className={`btn ${activeTab === 'pedido_cabecera' ? 'btn--cyan' : 'btn--outline'}`} 
            onClick={() => { setActiveTab('pedido_cabecera'); setFilter(''); }}>
            📋 Pedido (Cabecera)
          </button>
          <button 
            className={`btn ${activeTab === 'pedido_detalle' ? 'btn--cyan' : 'btn--outline'}`} 
            onClick={() => { setActiveTab('pedido_detalle'); setFilter(''); }}>
            📑 Pedido (Renglones)
          </button>
          <button 
            className={`btn ${activeTab === 'cotizacion_cabecera' ? 'btn--cyan' : 'btn--outline'}`} 
            onClick={() => { setActiveTab('cotizacion_cabecera'); setFilter(''); }}>
            📄 Cotización (Cabecera)
          </button>
          <button 
            className={`btn ${activeTab === 'cotizacion_detalle' ? 'btn--cyan' : 'btn--outline'}`} 
            onClick={() => { setActiveTab('cotizacion_detalle'); setFilter(''); }}>
            📝 Cotización (Renglones)
          </button>
        </div>

        {/* Selector de tabla ERP — solo pestañas de pedido, la tabla no está fija */}
        {isPedidoTab && selectedBranch === null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Tabla ERP destino:</label>
            <select
              value={currentTable}
              onChange={e => setPedidoTable(activeTab, e.target.value)}
              style={{ borderRadius: 'var(--radius)', minWidth: 220, fontWeight: 600 }}
            >
              <option value="">— elegir tabla —</option>
              {tables.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {!currentTable && (
              <span style={{ fontSize: 12, color: '#fb923c' }}>Elige una tabla para ver sus columnas</span>
            )}
          </div>
        )}

        {/* Leyenda */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
          {Object.entries(TYPE_BADGE).map(([k, v]) => (
            <span key={k} style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 20,
              background: 'var(--surface2)', color: v.color, fontWeight: 600,
            }}>● {v.label}</span>
          ))}
          {/* Leyenda adicional para priceList */}
          <span style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 20,
            background: 'var(--surface2)', color: '#4ade80', fontWeight: 600,
          }}>● Lista de Precio</span>
        </div>

        {/* Tabla */}
        <div className="card" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)', background: 'var(--surface2)' }}>
                <th style={{ textAlign: 'left', padding: '10px 10px', color: 'var(--text-muted)', width: 170 }}>Campo PowerSales</th>
                <th style={{ textAlign: 'left', padding: '10px 6px', color: 'var(--text-muted)', width: 150 }}>Descripción</th>
                <th style={{ textAlign: 'center', padding: '10px 6px', color: 'var(--text-muted)', width: 90 }}>Tipo</th>
                <th style={{ textAlign: 'center', padding: '10px 6px', color: 'var(--text-muted)', width: 60 }}>Req.</th>
                <th style={{ textAlign: 'left', padding: '10px 6px', color: 'var(--text-muted)' }}>Valor / Columna ERP</th>
              </tr>
            </thead>
            <tbody>
              {visibleFields.map((def, i) => {
                const { field, type, label, required, defaultErp, fixedValue } = def;
                const badge = TYPE_BADGE[type] ?? TYPE_BADGE.text;
                const rowBg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.02)';

                // Vista read-only de sucursal seleccionada
                if (selectedBranch !== null) {
                  const entityKey = entityForTab[activeTab] || 'articulo';
                  const effectiveVal = branchMapeo?.[entityKey]?.[field];
                  const globalVal    = fieldMap[field];
                  const isOverride   = effectiveVal !== undefined && String(effectiveVal) !== String(globalVal ?? '');
                  return (
                    <tr key={field} style={{ borderBottom: '1px solid var(--border)', background: rowBg }}>
                      <td style={{ padding: '9px 10px' }}>
                        <code style={{ background: 'var(--surface2)', padding: '2px 7px', borderRadius: 4, fontSize: 12 }}>{field}</code>
                      </td>
                      <td style={{ padding: '9px 6px', color: 'var(--text-muted)', fontSize: 12 }}>{label}</td>
                      <td style={{ padding: '9px 6px', textAlign: 'center' }}>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'var(--surface2)', color: badge.color, fontWeight: 600 }}>{badge.label}</span>
                      </td>
                      <td style={{ padding: '9px 6px', textAlign: 'center' }}>
                        {required ? <span style={{ color: '#f87171', fontSize: 13, fontWeight: 700 }}>✓</span> : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>}
                      </td>
                      <td style={{ padding: '9px 6px' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 13, color: isOverride ? '#fb923c' : '#d1d5db' }}>
                          {effectiveVal != null && effectiveVal !== '' ? String(effectiveVal) : <span style={{ color: '#4b5563', fontStyle: 'italic' }}>sin mapear</span>}
                        </span>
                        {isOverride && (
                          <span style={{ marginLeft: 8, fontSize: 10, background: '#431407', color: '#fb923c', padding: '1px 6px', borderRadius: 8, fontWeight: 600 }}>override</span>
                        )}
                      </td>
                    </tr>
                  );
                }

                let control;
                if (type === 'fixed') {
                  control = (
                    <span style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>
                      {String(fixedValue)} <span style={{ opacity: .5 }}>(sistema)</span>
                    </span>
                  );
                } else if (type === 'skuPrefix') {
                  control = (
                    <span style={{ color: '#f472b6', fontSize: 12, fontStyle: 'italic' }}>
                      🔑 Primeros <strong>5</strong> caracteres del código (automático)
                    </span>
                  );
                } else if (type === 'fixedId') {
                  const cur = fieldMap[field] !== undefined ? fieldMap[field] : '';
                  const isFieldMapped = cur !== '';
                  const inputStyle = {
                    width: '100%',
                    maxWidth: 300,
                    borderRadius: 'var(--radius-sm)',
                    transition: 'all 0.2s ease',
                    ...( !dbConnected && isFieldMapped ? {
                      borderColor: 'rgba(239, 68, 68, 0.6)',
                      color: '#f87171',
                      backgroundColor: 'rgba(239, 68, 68, 0.05)',
                      fontWeight: 500
                    } : {} )
                  };
                  control = (
                    <input type="text" value={cur} onChange={e => setFieldMapVal(activeTab, field, e.target.value)}
                      placeholder="Valor estático o nombre de columna"
                      disabled={!dbConnected}
                      style={inputStyle} />
                  );
                } else {
                  const cur = fieldMap[field] !== undefined ? fieldMap[field] : (defaultErp ?? '');
                  const isFieldMapped = cur !== '';
                  const selectStyle = {
                    width: '100%',
                    maxWidth: 300,
                    borderRadius: 'var(--radius-sm)',
                    transition: 'all 0.2s ease',
                    ...( !dbConnected && isFieldMapped ? {
                      borderColor: 'rgba(239, 68, 68, 0.6)',
                      color: '#f87171',
                      backgroundColor: 'rgba(239, 68, 68, 0.05)',
                      fontWeight: 500
                    } : {} )
                  };
                  control = (
                    <select value={cur} onChange={e => setFieldMapVal(activeTab, field, e.target.value)}
                      disabled={!dbConnected}
                      style={selectStyle}>
                      <option value="">(sin mapear — vacío)</option>
                      {!dbConnected && cur && !erpCols.includes(cur) && (
                        <option value={cur}>{cur} (Guardado)</option>
                      )}
                      {erpCols.map(col => <option key={col} value={col}>{col}</option>)}
                    </select>
                  );
                }

                return (
                  <tr key={field} style={{ borderBottom: '1px solid var(--border)', background: rowBg }}>
                    <td style={{ padding: '9px 10px' }}>
                      <code style={{ background: 'var(--surface2)', padding: '2px 7px', borderRadius: 4, fontSize: 12 }}>
                        {field}
                      </code>
                    </td>
                    <td style={{ padding: '9px 6px', color: 'var(--text-muted)', fontSize: 12 }}>{label}</td>
                    <td style={{ padding: '9px 6px', textAlign: 'center' }}>
                      <span style={{
                        fontSize: 10, padding: '2px 8px', borderRadius: 20,
                        background: 'var(--surface2)', color: badge.color, fontWeight: 600,
                      }}>{badge.label}</span>
                    </td>
                    <td style={{ padding: '9px 6px', textAlign: 'center' }}>
                      {required
                        ? <span style={{ color: '#f87171', fontSize: 13, fontWeight: 700 }}>✓</span>
                        : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>}
                    </td>
                    <td style={{ padding: '9px 6px' }}>{control}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Barra Lateral Derecha — solo maestro */}
      {mode === 'master' && (
        <aside className="sidebar-right">
          <div className="sidebar-right__label">Mapeo y Referencia</div>
          
          {/* Botón rápido para Mapeo Global */}
          <div 
            onClick={() => setSelectedBranch(null)}
            className={`sidebar-right__link${selectedBranch === null ? ' active' : ''}`}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Globe size={18} strokeWidth={1.75} /> 
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span>Mapeo Global</span>
                {dbRef.host && (
                  <span style={{ 
                    fontSize: 10, 
                    color: selectedBranch === null ? 'rgba(0, 212, 255, 0.7)' : 'var(--text-muted)', 
                    fontWeight: 400 
                  }}>
                    Ref: {dbRef.host} ({dbRef.name})
                  </span>
                )}
              </span>
            </span>
            {selectedBranch === null && <Star size={14} fill="currentColor" />}
          </div>

          <div className="sidebar-right__label" style={{ marginTop: 12 }}>Sucursales</div>

          {branches.map(b => {
            const isSelected = selectedBranch === b.branch_id;
            return (
              <div 
                key={b.branch_id}
                onClick={() => setSelectedBranch(b.branch_id)}
                className={`sidebar-right__link${isSelected ? ' active-branch' : ''}`}
                style={{ opacity: b.online ? 1 : 0.6 }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Building2 size={18} strokeWidth={1.75} />
                  <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <span>Sucursal {b.branch_id}</span>
                    {b.hostname && (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>
                        {b.hostname}
                      </span>
                    )}
                  </span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isSelected && <Star size={14} fill="currentColor" />}
                  <span style={{ 
                    width: 7, 
                    height: 7, 
                    borderRadius: '50%', 
                    background: b.online ? 'var(--green)' : 'var(--red)',
                    boxShadow: b.online ? '0 0 6px var(--green)' : 'none',
                    display: 'inline-block'
                  }} title={b.online ? 'Online' : 'Offline'} />
                </span>
              </div>
            );
          })}

          {branches.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', padding: '16px 20px' }}>
              No hay sucursales registradas.
            </span>
          )}
        </aside>
      )}
    </div>
  );
}
