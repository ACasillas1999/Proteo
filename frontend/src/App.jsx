import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard      from './pages/Dashboard.jsx';
import Auditoria      from './pages/Auditoria.jsx';
import Configuracion  from './pages/Configuracion.jsx';
import Mapeo          from './pages/Mapeo.jsx';
import WorkerStatus   from './components/WorkerStatus.jsx';
import { useWebSocket } from './hooks/useWebSocket.js';
import { Zap, ClipboardList, Map, Settings } from 'lucide-react';

const NAV = [
  { to: '/',              icon: Zap,           label: 'Dashboard' },
  { to: '/auditoria',     icon: ClipboardList, label: 'Auditoría' },
  { to: '/mapeo',         icon: Map,           label: 'Mapeo' },
  { to: '/configuracion', icon: Settings,      label: 'Configuración' },
];

export default function App() {
  const { events, wsStatus } = useWebSocket();

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="app-shell">
        {/* Top bar */}
        <header className="topbar">
          <div className="topbar__logo">PowerSales<span>Sync</span></div>
          <div className="topbar__spacer" />
          <WorkerStatus wsEvents={events} wsStatus={wsStatus} />
        </header>

        {/* Sidebar */}
        <nav className="sidebar">
          <div className="sidebar__label">Menú</div>
          {NAV.map(n => (
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
            <Route path="/"              element={<Dashboard wsEvents={events} />} />
            <Route path="/auditoria"     element={<Auditoria />} />
            <Route path="/mapeo"         element={<Mapeo />} />
            <Route path="/configuracion" element={<Configuracion />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
