import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import MasterDashboard from './pages/MasterDashboard.jsx';
import BranchDashboard from './pages/BranchDashboard.jsx';
import Auditoria      from './pages/Auditoria.jsx';
import Configuracion  from './pages/Configuracion.jsx';
import Mapeo          from './pages/Mapeo.jsx';
import Payload        from './pages/Payload.jsx';
import Webhooks       from './pages/Webhooks.jsx';
import Sucursales     from './pages/Sucursales.jsx';
import WorkerStatus   from './components/WorkerStatus.jsx';
import { useWebSocket }  from './hooks/useWebSocket.js';
import { ModeProvider, useMode } from './context/ModeContext.jsx';
import { Zap, ClipboardList, Map, Settings, SendHorizontal, Webhook, Building2 } from 'lucide-react';

const NAV_MASTER = [
  { to: '/',              icon: Zap,            label: 'Dashboard' },
  { to: '/sucursales',    icon: Building2,      label: 'Sucursales' },
  { to: '/webhooks',      icon: Webhook,        label: 'Webhooks' },
  { to: '/mapeo',         icon: Map,            label: 'Mapeo' },
  { to: '/configuracion', icon: Settings,       label: 'Configuración' },
];

const NAV_BRANCH = [
  { to: '/',              icon: Zap,            label: 'Estado' },
  { to: '/webhooks',      icon: Webhook,        label: 'Webhooks' },
  { to: '/auditoria',     icon: ClipboardList,  label: 'Auditoría' },
  { to: '/payloads',      icon: SendHorizontal, label: 'Payloads' },
  { to: '/configuracion', icon: Settings,       label: 'Configuración' },
];

function AppShell() {
  const { mode, branchId, loading } = useMode();
  const { events, wsStatus } = useWebSocket();

  if (loading) return <div style={{ padding: 40, color: '#9ca3af' }}>Cargando…</div>;

  const isMaster = mode === 'master';
  const nav      = isMaster ? NAV_MASTER : NAV_BRANCH;
  const title    = isMaster ? 'Maestro' : `Sucursal ${branchId ?? ''}`;

  return (
    <div className="app-shell">
      {/* Top bar */}
      <header className="topbar">
        <div className="topbar__logo">
          PowerSales<span>Sync</span>
          <span style={{ marginLeft: 10, fontSize: 11, color: isMaster ? '#fb923c' : '#38bdf8',
            background: isMaster ? '#431407' : '#0c4a6e',
            padding: '2px 8px', borderRadius: 8, fontWeight: 600 }}>
            {title}
          </span>
        </div>
        <div className="topbar__spacer" />
        <WorkerStatus wsEvents={events} wsStatus={wsStatus} />
      </header>

      {/* Sidebar */}
      <nav className="sidebar">
        <div className="sidebar__label">Menú</div>
        {nav.map(n => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) => `sidebar__link${isActive ? ' active' : ''}`}
          >
            <n.icon size={18} strokeWidth={1.75} /> {n.label}
          </NavLink>
        ))}
      </nav>

      {/* Main */}
      <main className="main-content">
        <Routes>
          <Route path="/" element={
            isMaster
              ? <MasterDashboard wsEvents={events} />
              : <BranchDashboard wsEvents={events} />
          } />
          <Route path="/auditoria"     element={<Auditoria />} />
          <Route path="/payloads"      element={<Payload />} />
          <Route path="/webhooks"      element={<Webhooks wsEvents={events} />} />
          <Route path="/mapeo"         element={<Mapeo />} />
          <Route path="/sucursales"    element={<Sucursales wsEvents={events} />} />
          <Route path="/configuracion" element={<Configuracion />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ModeProvider>
        <AppShell />
      </ModeProvider>
    </BrowserRouter>
  );
}
