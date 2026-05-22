import { useState, useEffect } from 'react';
import axios from 'axios';

const TABLAS_DISPONIBLES = ['articulo', 'articuloalm', 'cliente', 'proveedor', 'precio'];

export default function Configuracion() {
  const [cfg,     setCfg]     = useState(null);
  const [saved,   setSaved]   = useState(false);
  const [binlog,  setBinlog]  = useState(null);
  const [local,   setLocal]   = useState({
    tablas_activas: ['articulo'],
    max_retries:    3,
    retry_backoff_ms: 1000,
  });

  useEffect(() => {
    axios.get('/api/config').then(r => {
      if (r.data.ok) { setCfg(r.data.data); setLocal(r.data.data); }
    }).catch(() => {});

    axios.get('/api/status').then(r => {
      if (r.data.ok) setBinlog(r.data.worker);
    }).catch(() => {});
  }, []);

  const toggleTabla = tabla => {
    setLocal(prev => {
      const active = prev.tablas_activas.includes(tabla)
        ? prev.tablas_activas.filter(t => t !== tabla)
        : [...prev.tablas_activas, tabla];
      return { ...prev, tablas_activas: active };
    });
  };

  const save = async () => {
    try {
      const { data } = await axios.put('/api/config', {
        tablas_activas:   local.tablas_activas,
        max_retries:      parseInt(local.max_retries),
        retry_backoff_ms: parseInt(local.retry_backoff_ms),
      });
      if (data.ok) { setCfg(data.data); setSaved(true); setTimeout(() => setSaved(false), 2000); }
    } catch { /* ignore */ }
  };

  return (
    <div>
      <h1 className="section-title">⚙️ Configuración del Worker</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Left: worker config */}
        <div className="card">
          <div className="config-section">
            <h3>Tablas activas</h3>
            {TABLAS_DISPONIBLES.map(tabla => {
              const on = local.tablas_activas?.includes(tabla);
              return (
                <div key={tabla} className="config-field">
                  <label>{tabla}</label>
                  <div
                    className={`toggle__switch ${on ? 'on' : ''}`}
                    onClick={() => toggleTabla(tabla)}
                    role="switch"
                    aria-checked={on}
                  />
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    {on ? 'Activa' : 'Inactiva'}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="config-section">
            <h3>Reintentos</h3>
            <div className="config-field">
              <label>Máximo de reintentos</label>
              <input
                type="number" min={1} max={10}
                value={local.max_retries ?? 3}
                onChange={e => setLocal(p => ({ ...p, max_retries: e.target.value }))}
              />
            </div>
            <div className="config-field">
              <label>Backoff base (ms)</label>
              <input
                type="number" min={100} max={30000} step={100}
                value={local.retry_backoff_ms ?? 1000}
                onChange={e => setLocal(p => ({ ...p, retry_backoff_ms: e.target.value }))}
              />
            </div>
          </div>

          <button
            className={`btn ${saved ? 'btn--green' : 'btn--cyan'}`}
            onClick={save}
          >
            {saved ? '✓ Guardado' : '💾 Guardar configuración'}
          </button>
        </div>

        {/* Right: binlog info */}
        <div className="card">
          <div className="config-section">
            <h3>Estado del Binlog</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: 'Servidor',    val: `${import.meta.env.VITE_MYSQL_HOST || '192.168.60.42'}:3306` },
                { label: 'Conexión',    val: binlog?.binlog || '—' },
                { label: 'Iniciado',    val: binlog?.startedAt ? new Date(binlog.startedAt).toLocaleString('es-MX') : '—' },
                { label: 'Último evento', val: binlog?.lastEvent ? new Date(binlog.lastEvent).toLocaleString('es-MX') : '—' },
                { label: 'Clientes WS', val: binlog?.wsClients ?? '—' },
              ].map(({ label, val }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span className="text-muted" style={{ fontSize: 13 }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{val}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="config-section">
            <h3>Config actual en servidor</h3>
            {cfg ? (
              <pre style={{ background: 'var(--surface2)', padding: 12, borderRadius: 8, fontSize: 12, color: 'var(--cyan)' }}>
                {JSON.stringify(cfg, null, 2)}
              </pre>
            ) : (
              <p className="text-muted">Cargando…</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
