import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

export default function WorkerStatus({ wsEvents, wsStatus }) {
  const [worker, setWorker] = useState({ paused: false, binlog: 'unknown' });

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/status');
      if (data.ok) setWorker(data.worker);
    } catch { /* ignore */ }
  }, []);

  // Poll every 10s
  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, 10_000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  // Update paused state from WebSocket events
  useEffect(() => {
    const last = wsEvents.find(e => e.event === 'worker_status');
    if (last) setWorker(prev => ({ ...prev, ...last.data }));
  }, [wsEvents]);

  const togglePause = async () => {
    const endpoint = worker.paused ? '/api/worker/resume' : '/api/worker/pause';
    try {
      await axios.post(endpoint);
      setWorker(prev => ({ ...prev, paused: !prev.paused }));
    } catch { /* ignore */ }
  };

  let pill = 'disconnected';
  let label = 'DESCONECTADO';
  if (wsStatus === 'connected' && !worker.paused) { pill = 'active'; label = 'ACTIVO'; }
  else if (worker.paused) { pill = 'paused'; label = 'PAUSADO'; }

  return (
    <div className="flex items-center gap-8">
      <div className={`worker-pill worker-pill--${pill}`}>
        <div className="dot" />
        {label}
      </div>
      <button
        className={`btn btn--sm ${worker.paused ? 'btn--green' : 'btn--ghost'}`}
        onClick={togglePause}
      >
        {worker.paused ? '▶ Reanudar' : '⏸ Pausar'}
      </button>
      <span className="text-muted" style={{ fontSize: 11 }}>
        WS {wsStatus === 'connected' ? '●' : '○'}
      </span>
    </div>
  );
}
