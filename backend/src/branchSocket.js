'use strict';
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { isValidToken } = require('./authMiddleware');

const PING_INTERVAL_MS = 15_000;

const branches = new Map();  // branchId (number) -> WebSocket
const pending  = new Map();  // reqId (string)     -> { resolve, reject, timer, branchId }

let wss = null;
let pingTimer = null;

function extractAuth(req) {
  const url = new URL(req.url, 'http://internal');
  const branchIdRaw = url.searchParams.get('branch_id');
  const branchId = parseInt(branchIdRaw);

  let token = url.searchParams.get('token');
  const authHeader = req.headers.authorization;
  if (!token && authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  return { branchId, token };
}

function rejectUpgrade(socket, statusCode, message) {
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\n\r\n`);
  socket.destroy();
}

function registerBranch(branchId, ws) {
  const old = branches.get(branchId);
  if (old && old !== ws) {
    old.terminate();
  }
  branches.set(branchId, ws);
  console.log(`[BRANCH-WS] Sucursal ${branchId} conectada (total: ${branches.size})`);
}

function rejectPendingForBranch(branchId, reason) {
  for (const [reqId, p] of pending.entries()) {
    if (p.branchId === branchId) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      pending.delete(reqId);
    }
  }
}

function unregisterBranch(branchId, ws) {
  if (branches.get(branchId) === ws) {
    branches.delete(branchId);
    console.log(`[BRANCH-WS] Sucursal ${branchId} desconectada (total: ${branches.size})`);
  }
  rejectPendingForBranch(branchId, 'branch_disconnected');
}

function handleMessage(branchId, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  if (msg.type === 'query_inventory_result' && msg.reqId) {
    const p = pending.get(msg.reqId);
    if (!p) return; // ya expiró o no es de este proceso
    clearTimeout(p.timer);
    pending.delete(msg.reqId);
    if (msg.ok) p.resolve(msg.data ?? []);
    else p.reject(new Error(msg.error || 'branch_error'));
  }
}

function attach(server) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://internal');
    if (url.pathname !== '/branch-ws') return; // no es nuestro, ignorar

    const { branchId, token } = extractAuth(req);
    if (!branchId || isNaN(branchId)) return rejectUpgrade(socket, 400, 'Bad Request');
    if (!isValidToken(token))          return rejectUpgrade(socket, 401, 'Unauthorized');

    wss.handleUpgrade(req, socket, head, ws => {
      ws.isAlive = true;
      ws.branchId = branchId;
      registerBranch(branchId, ws);

      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', raw => handleMessage(branchId, raw));
      ws.on('close', () => unregisterBranch(branchId, ws));
      ws.on('error', () => unregisterBranch(branchId, ws));
    });
  });

  pingTimer = setInterval(() => {
    for (const [branchId, ws] of branches.entries()) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue; // el listener 'close' hace el cleanup del registro
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, PING_INTERVAL_MS);
}

function isBranchOnline(branchId) {
  const ws = branches.get(Number(branchId));
  return !!ws && ws.readyState === WebSocket.OPEN;
}

function sendQuery(branchId, params, timeoutMs = 8000) {
  const ws = branches.get(Number(branchId));
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(Object.assign(new Error('branch_offline'), { code: 'branch_offline' }));
  }

  return new Promise((resolve, reject) => {
    const reqId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(Object.assign(new Error('timeout'), { code: 'timeout' }));
    }, timeoutMs);

    pending.set(reqId, { resolve, reject, timer, branchId: Number(branchId) });
    ws.send(JSON.stringify({ type: 'query_inventory', reqId, params }));
  });
}

module.exports = { attach, sendQuery, isBranchOnline };
