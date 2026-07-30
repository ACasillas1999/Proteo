'use strict';
const WebSocket = require('ws');
const { query } = require('./db');
const { mapArticuloalm } = require('./handlers/articuloalm');

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

let ws            = null;
let reconnectTimer = null;
let attempt       = 0;
let stopped       = false;

function toWsUrl(centralUrl) {
  return centralUrl.replace(/^http/, 'ws').replace(/\/$/, '');
}

async function buildInventoryData(params = {}) {
  const { ProductId, WarehouseId, limit } = params;
  const lim = Math.max(1, Math.min(parseInt(limit) || 200, 500));

  let sql = 'SELECT * FROM articuloalm WHERE 1=1';
  const args = [];

  if (ProductId)   { sql += ' AND Clave_Articulo = ?'; args.push(ProductId); }
  if (WarehouseId) { sql += ' AND Almacen = ?';         args.push(WarehouseId); }

  sql += ' LIMIT ?';
  args.push(lim);

  const [rows] = await query(sql, args);
  const data = [];
  for (const row of rows) data.push(await mapArticuloalm(row));
  return data;
}

async function handleQuery(reqId, params) {
  try {
    const data = await buildInventoryData(params);
    ws.send(JSON.stringify({ type: 'query_inventory_result', reqId, ok: true, data }));
  } catch (err) {
    ws.send(JSON.stringify({ type: 'query_inventory_result', reqId, ok: false, error: err.message }));
  }
}

function scheduleReconnect() {
  if (stopped) return;
  attempt += 1;
  const delay = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  reconnectTimer = setTimeout(connect, delay);
}

function connect() {
  const centralUrl = process.env.CENTRAL_URL;
  const branchId   = process.env.PS_BRANCH_ID;
  const token      = process.env.PS_TOKEN;

  const url = `${toWsUrl(centralUrl)}/branch-ws?branch_id=${branchId}`;
  ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });

  ws.on('open', () => {
    attempt = 0;
    console.log(`[BRANCH-WS] Conectado al maestro (branch ${branchId})`);
  });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'query_inventory' && msg.reqId) {
      handleQuery(msg.reqId, msg.params || {});
    }
  });

  ws.on('close', () => {
    console.warn('[BRANCH-WS] Conexión con maestro cerrada, reintentando...');
    scheduleReconnect();
  });

  ws.on('error', err => {
    console.error('[BRANCH-WS] Error de conexión:', err.message);
  });
}

function startBranchSocketClient() {
  const centralUrl = process.env.CENTRAL_URL;
  const branchId   = process.env.PS_BRANCH_ID;

  if (!centralUrl || !branchId) {
    console.log('[BRANCH-WS] CENTRAL_URL o PS_BRANCH_ID no definidos — cliente deshabilitado (modo maestro).');
    return;
  }

  stopped = false;
  connect();
}

function stopBranchSocketClient() {
  stopped = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) ws.terminate();
}

module.exports = { startBranchSocketClient, stopBranchSocketClient };
