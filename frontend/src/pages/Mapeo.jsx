import { useState, useEffect } from 'react';
import axios from 'axios';

const TYPE_BADGE = {
  text:       { label: 'Texto',      color: '#22d3ee' },
  number:     { label: 'Número',     color: '#a78bfa' },
  boolean:    { label: 'Booleano',   color: '#34d399' },
  fixedId:    { label: 'ID fijo',    color: '#fb923c' },
  skuPrefix:  { label: 'Prefijo SKU', color: '#f472b6' },
  categoryId: { label: 'Categoría',  color: '#fbbf24' },
  fixed:      { label: 'Sistema',    color: '#6b7280' },
};

export default function Mapeo() {
  const [mapeo,   setMapeo]   = useState(null);
  const [fields,  setFields]  = useState({ psFields: [], erpColumns: [] });
  const [loading, setLoading] = useState(true);
  const [saved,   setSaved]   = useState(false);
  const [filter,  setFilter]  = useState('');

  useEffect(() => {
    Promise.all([
      axios.get('/api/mapeo'),
      axios.get('/api/mapeo/fields'),
    ]).then(([m, f]) => {
      const psFields      = f.data.psFields ?? [];
      const savedFieldMap = m.data.data?.articulo?.fieldMap ?? {};

      // Pre-inicializar con defaults del código, luego sobrescribir con lo guardado en BD
      const initialFieldMap = {};
      for (const def of psFields) {
        if (def.type === 'fixed' || def.type === 'skuPrefix') continue; // automáticos, no se mapean
        if (def.type === 'text' || def.type === 'number' || def.type === 'boolean' || def.type === 'fixedId' || def.type === 'categoryId') {
          initialFieldMap[def.field] = savedFieldMap[def.field] !== undefined
            ? savedFieldMap[def.field]
            : (def.defaultErp ?? '');
        }
      }

      setMapeo({
        ...m.data.data,
        articulo: { ...m.data.data?.articulo, fieldMap: initialFieldMap },
      });
      setFields({ psFields, erpColumns: f.data.erpColumns ?? [] });
    }).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    try { await axios.put('/api/mapeo', mapeo); setSaved(true); setTimeout(() => setSaved(false), 2500); }
    catch { /* ignore */ }
  };

  const setFieldMapVal = (psField, val) =>
    setMapeo(p => ({ ...p, articulo: { ...p.articulo, fieldMap: { ...p.articulo.fieldMap, [psField]: val } } }));

  if (loading) return <p className="text-muted" style={{ padding: 32 }}>Cargando…</p>;
  if (!mapeo)  return <p className="text-muted" style={{ padding: 32 }}>Error al cargar.</p>;

  const art      = mapeo.articulo ?? {};
  const fieldMap = art.fieldMap ?? {};
  const psFields = Array.isArray(fields.psFields)
    ? fields.psFields
    : Object.entries(fields.psFields).map(([k, v]) => ({ field: k, ...v }));
  const erpCols  = fields.erpColumns ?? [];

  const visibleFields = psFields.filter(f =>
    !filter ||
    f.field.toLowerCase().includes(filter.toLowerCase()) ||
    (f.label ?? '').toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <h1 className="section-title" style={{ margin: 0 }}>🗺️ Mapeo de Campos — Artículos</h1>
        <input
          placeholder="🔍 Filtrar campos…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ flex: 1, minWidth: 180, maxWidth: 280, borderRadius: 'var(--radius)' }}
        />
        <button className={`btn ${saved ? 'btn--green' : 'btn--cyan'}`} onClick={save}>
          {saved ? '✓ Guardado' : '💾 Guardar mapeo'}
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
              const { field, type, label, required, defaultErp, defaultFixed, fixedValue } = def;
              const badge = TYPE_BADGE[type] ?? TYPE_BADGE.text;
              const rowBg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.02)';

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
                    🔑 Primeros <strong>5</strong> caracteres de <code style={{ background: 'var(--surface2)', padding: '1px 6px', borderRadius: 4 }}>Clave_Articulo</code> (automático)
                  </span>
                );
              } else {
                const cur = fieldMap[field] !== undefined ? fieldMap[field] : (defaultErp ?? '');
                control = (
                  <select value={cur} onChange={e => setFieldMapVal(field, e.target.value)}
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
