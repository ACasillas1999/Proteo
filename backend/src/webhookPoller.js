'use strict';
const os    = require('os');
const axios = require('axios');
const { query }                             = require('./db');
const { getConfig, setConfig, saveWebhookLog, saveFieldMapping } = require('./localdb');
const { handleProductUpdate, handleCustomerUpdate } = require('./webhookHandlers');
const { broadcast }                         = require('./websocket');

const POLL_INTERVAL_MS   = 30_000;
const MAPPING_SYNC_MS    = 24 * 60 * 60 * 1000; // 24h
const HEARTBEAT_INTERVAL = 60_000;

let _pollTimer      = null;
let _heartbeatTimer = null;
let _mappingTimer   = null;
let _isPolling      = false;

function buildKey(entidad, claveRegistro) {
  if (entidad === 'articulo') return { SKU: claveRegistro };
  if (entidad === 'cliente')  return { CustomerNumber: claveRegistro };
  return { id: claveRegistro };
}

async function syncMapping() {
  const centralUrl = process.env.CENTRAL_URL;
  const branchId   = parseInt(process.env.PS_BRANCH_ID);
  const token      = process.env.PS_TOKEN;
  if (!centralUrl || !branchId) return;

  try {
    const res = await axios.get(`${centralUrl}/api/mapeo/branch/${branchId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10_000,
    });
    const data = res.data?.data;
    if (!data) return;

    if (data.articulo)    await saveFieldMapping('articulo',    data.articulo);
    if (data.articuloalm) await saveFieldMapping('articuloalm', data.articuloalm);
    if (data.cliente)     await saveFieldMapping('cliente',     data.cliente);

    console.log(`[MAPEO SYNC] Mapeo actualizado desde maestro para branch ${branchId}`);
  } catch (err) {
    console.error('[MAPEO SYNC] Error al sincronizar mapeo:', err.message);
  }
}

async function sendHeartbeat(lastPollId) {
  const centralUrl = process.env.CENTRAL_URL;
  const branchId   = parseInt(process.env.PS_BRANCH_ID);
  const token      = process.env.PS_TOKEN;
  if (!centralUrl || !branchId) return;

  let erpConnected = 0;
  try { await query('SELECT 1'); erpConnected = 1; } catch {}

  await axios.post(`${centralUrl}/api/branches/heartbeat`, {
    branch_id:     branchId,
    last_poll_id:  lastPollId ?? 0,
    erp_connected: erpConnected,
    version:       process.env.npm_package_version || '1.0',
    hostname:      os.hostname(),
  }, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 5_000,
  }).catch(() => {}); // heartbeat falla silencioso
}

async function pollWebhooks() {
  if (_isPolling) return;
  _isPolling = true;

  const centralUrl = process.env.CENTRAL_URL;
  const branchId   = parseInt(process.env.PS_BRANCH_ID);
  const token      = process.env.PS_TOKEN;

  if (!centralUrl || !branchId) { _isPolling = false; return; }

  try {
    const lastId = await getConfig('last_webhook_id', 0);

    const res = await axios.get(`${centralUrl}/api/webhooks/pending`, {
      params:  { branch_id: branchId, after_id: lastId, limit: 100 },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15_000,
    });

    const records = res.data?.data ?? [];
    let maxId = lastId;

    if (records.length > 0) {
      console.log(`[WEBHOOK POLLER] ${records.length} webhook(s) pendiente(s) para branch ${branchId}`);

      for (const rec of records) {
        const data = typeof rec.datos === 'string' ? JSON.parse(rec.datos) : rec.datos;
        try {
          const key = buildKey(rec.entidad, rec.clave_registro);
          if      (rec.entidad === 'articulo') await handleProductUpdate(key, data);
          else if (rec.entidad === 'cliente')  await handleCustomerUpdate(key, data);
          else await saveWebhookLog(rec.entidad, rec.clave_registro, data, 2, 'Entidad no soportada en poller');
        } catch (err) {
          console.error(`[WEBHOOK POLLER] Error procesando webhook #${rec.id}:`, err.message);
          await saveWebhookLog(rec.entidad, rec.clave_registro, data, 2, err.message);
        }
        if (rec.id > maxId) maxId = rec.id;
      }

      await setConfig('last_webhook_id', maxId);
      broadcast('webhook_poll', { fetched: records.length, lastId: maxId });
    }

    // Heartbeat after every poll cycle (even when no new records)
    await sendHeartbeat(maxId);

  } catch (err) {
    console.error('[WEBHOOK POLLER] Error al contactar maestro:', err.message);
  } finally {
    _isPolling = false;
  }
}

function startWebhookPoller(intervalMs = POLL_INTERVAL_MS) {
  const centralUrl = process.env.CENTRAL_URL;
  const branchId   = process.env.PS_BRANCH_ID;

  if (!centralUrl || !branchId) {
    console.log('[WEBHOOK POLLER] CENTRAL_URL o PS_BRANCH_ID no definidos — poller deshabilitado (modo maestro).');
    return;
  }

  if (_pollTimer)      clearInterval(_pollTimer);
  if (_heartbeatTimer) clearInterval(_heartbeatTimer);
  if (_mappingTimer)   clearInterval(_mappingTimer);

  console.log(`[WEBHOOK POLLER] Iniciado — branch ${branchId}, maestro: ${centralUrl}, intervalo: ${intervalMs}ms`);

  // Sync mapping immediately on start, then every 24h
  syncMapping();
  _mappingTimer = setInterval(syncMapping, MAPPING_SYNC_MS);

  // Poll immediately, then on interval
  pollWebhooks();
  _pollTimer = setInterval(pollWebhooks, intervalMs);
}

function stopWebhookPoller() {
  if (_pollTimer)      { clearInterval(_pollTimer);      _pollTimer      = null; }
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
  if (_mappingTimer)   { clearInterval(_mappingTimer);   _mappingTimer   = null; }
}

module.exports = { startWebhookPoller, stopWebhookPoller };
