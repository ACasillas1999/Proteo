import { useEffect, useRef, useState, useCallback } from 'react';

const WS_PORT = import.meta.env.VITE_WS_PORT || 3002;
const WS_URL  = `ws://${window.location.hostname}:${WS_PORT}`;
const RECONNECT_MS = 3000;
const MAX_EVENTS = 100;

export function useWebSocket() {
  const [events,  setEvents]  = useState([]);
  const [status,  setStatus]  = useState('disconnected'); // 'connected'|'disconnected'|'error'
  const wsRef     = useRef(null);
  const timerRef  = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen  = () => setStatus('connected');
    ws.onclose = () => {
      setStatus('disconnected');
      timerRef.current = setTimeout(connect, RECONNECT_MS);
    };
    ws.onerror = () => setStatus('error');

    ws.onmessage = evt => {
      try {
        const msg = JSON.parse(evt.data);
        setEvents(prev => [msg, ...prev].slice(0, MAX_EVENTS));
      } catch { /* ignore */ }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { events, wsStatus: status };
}
