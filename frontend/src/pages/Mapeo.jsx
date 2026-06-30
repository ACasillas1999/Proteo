import { useState, useEffect } from 'react';
import axios from 'axios';
import { useMode } from '../context/ModeContext.jsx';

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
  
  const [fieldsArt, setFieldsArt] = useState({ psFields: [], erpColumns: [] });
  const [fieldsAlm, setFieldsAlm] = useState({ psFields: [], erpColumns: [] });
  const [fieldsCli, setFieldsCli] = useState({ psFields: [], erpColumns: [] });

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
      axios.get('/api/mapeo/fields/cliente')
    ]).then(([m, fArt, fAlm, fCli]) => {
      
      const setupFields = (fData, savedMap) => {
        const psFields = fData.psFields ?? [];
        const erpColumns = fData.erpColumns ?? [];
        const fieldMap = savedMap ?? {};
        
        const initialFieldMap = {};
        for (const def of psFields) {
          if (def.type === 'fixed' || def.type === 'skuPrefix') continue;
          
          const saved = fieldMap[def.field];
          if (def.type === 'fixedId') {
            initialFieldMap[def.field] = saved !== undefined ? saved : (def.defaultFixed || '');
          } else {
            const valueToUse = saved !== undefined ? saved : (def.defaultErp || '');
            const isValidErpCol = valueToUse !== '' && erpColumns.includes(String(valueToUse));
            initialFieldMap[def.field] = isValidErpCol ? valueToUse : '';
          }
        }
        return { psFields, erpColumns, initialFieldMap };
      };

      const artData = setupFields(fArt.data, m.data.data?.articulo?.fieldMap);
      const almData = setupFields(fAlm.data, m.data.data?.articuloalm?.fieldMap);
      const cliData = setupFields(fCli.data, m.data.data?.cliente?.fieldMap);

      setMapeo({
        ...m.data.data,
        articulo: { ...m.data.data?.articulo, fieldMap: artData.initialFieldMap },
        articuloalm: { ...m.data.data?.articuloalm, fieldMap: almData.initialFieldMap },
        cliente: { ...m.data.data?.cliente, fieldMap: cliData.initialFieldMap },
      });

      setFieldsArt({ psFields: artData.psFields, erpColumns: artData.erpColumns });
      setFieldsAlm({ psFields: almData.psFields, erpColumns: almData.erpColumns });
      setFieldsCli({ psFields: cliData.psFields, erpColumns: cliData.erpColumns });

    }).finally(() => setLoading(false));
  }, []);

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
  const entityForTab = { articulo: 'articulo', pricelists: 'articulo', articuloalm: 'articuloalm', cliente: 'cliente' };
  const fieldsForTab = { articulo: fieldsArt, pricelists: fieldsArt, articuloalm: fieldsAlm, cliente: fieldsCli };
  const currentData = mapeo[entityForTab[activeTab] ?? 'articulo'];
  const currentFields = fieldsForTab[activeTab] ?? fieldsArt;
  const fieldMap = currentData?.fieldMap ?? {};

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
    <div>
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
          <button className={`btn ${saved ? 'btn--green' : 'btn--cyan'}`} onClick={save}>
            {saved ? '✓ Guardado' : '💾 Guardar mapeo'}
          </button>
        )}
        {selectedBranch !== null && (
          <span style={{ fontSize: 12, color: '#fb923c', fontWeight: 600 }}>
            Solo lectura — mapeo efectivo de sucursal {selectedBranch}
          </span>
        )}
      </div>

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
      </div>

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
                const entityKey = { articulo: 'articulo', pricelists: 'articulo', articuloalm: 'articuloalm', cliente: 'cliente' }[activeTab];
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
                control = (
                  <input type="text" value={cur} onChange={e => setFieldMapVal(activeTab, field, e.target.value)}
                    placeholder="Valor estático o nombre de columna"
                    style={{ width: '100%', maxWidth: 300, borderRadius: 'var(--radius-sm)' }} />
                );
              } else {
                const cur = fieldMap[field] !== undefined ? fieldMap[field] : (defaultErp ?? '');
                control = (
                  <select value={cur} onChange={e => setFieldMapVal(activeTab, field, e.target.value)}
                    style={{ width: '100%', maxWidth: 300, borderRadius: 'var(--radius-sm)' }}>
                    <option value="">(sin mapear — vacío)</option>
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
  );
}
