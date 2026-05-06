'use strict';
const { WebSocketServer } = require('ws');

let _wss = null;

function initWebSocket(port) {
  _wss = new WebSocketServer({ port });
  console.log(`[WS] WebSocket server → ws://localhost:${port}`);

  _wss.on('connection', ws => {
    console.log(`[WS] Client connected (total: ${_wss.clients.size})`);
    ws.on('close', () => console.log(`[WS] Client disconnected (total: ${_wss.clients.size})`));
    ws.on('error', err => console.error('[WS] Client error:', err.message));
  });

  return _wss;
}

/**
 * Emite un evento JSON a todos los clientes conectados.
 * @param {string} event  - 'sync_ok' | 'sync_error' | 'worker_status'
 * @param {object} data
 */
function broadcast(event, data) {
  if (!_wss) return;
  const payload = JSON.stringify({ event, data, ts: Date.now() });
  for (const client of _wss.clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(payload);
    }
  }
}

function getConnectedCount() {
  if (!_wss) return 0;
  return [..._wss.clients].filter(c => c.readyState === 1).length;
}

module.exports = { initWebSocket, broadcast, getConnectedCount };
