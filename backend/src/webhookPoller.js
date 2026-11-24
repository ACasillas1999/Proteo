'use strict';
const os    = require('os');
const axios = require('axios');
const { query }                             = require('./db');
const { getConfig, setConfig, saveWebhookLog, saveFieldMapping, getLocalSyncSummary } = require('./localdb');
const { handleProductUpdate, handleCustomerUpdate, handleOrderInsert } = require('./webhookHandlers');
const { broadcast }                         = require('./websocket');

const POLL_INTERVAL_MS = 30_000;
const MAPPING_SYNC_MS  = 24 * 60 * 60 * 1000; // 24h

let _pollTimer      = null;
let _heartbeatTimer = null;
let _mappingTimer   = null;
let _isPolling      = false;

function buildKey(entidad, claveRegistro) {
  if (entidad === 'articulo') return { SKU: claveRegistro };
  if (entidad === 'cliente')  return { CustomerNumber: claveRegistro };
  return { id: claveRegistro };
}

// Campos que NUNCA se sobreescriben desde maestro — siempre vienen del .env local
const LOCAL_ONLY_FIELDS = ['BranchId'];

function filterLocalFields(mapping) {
  if (!mapping || typeof mapping !== 'object') return mapping;
  const filtered = { ...mapping };
  for (const field of LOCAL_ONLY_FIELDS) delete filtered[field];
  return filtered;
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

    // BranchId se excluye — cada sucursal usa su propio PS_BRANCH_ID del .env
    if (data.articulo)    await saveFieldMapping('articulo',    filterLocalFields(data.articulo));
    if (data.articuloalm) await saveFieldMapping('articuloalm', filterLocalFields(data.articuloalm));
    if (data.cliente)     await saveFieldMapping('cliente',     filterLocalFields(data.cliente));
    if (data.pedido_cabecera) await saveFieldMapping('pedido_cabecera', filterLocalFields(data.pedido_cabecera));
    if (data.pedido_detalle)  await saveFieldMapping('pedido_detalle',  filterLocalFields(data.pedido_detalle));
    if (data.pedido_cabecera_table !== undefined) await setConfig('pedido_cabecera_table', data.pedido_cabecera_table);
    if (data.pedido_detalle_table !== undefined)  await setConfig('pedido_detalle_table',  data.pedido_detalle_table);

    console.log(`[MAPEO SYNC] Mapeo actualizado desde maestro para branch ${branchId} (BranchId preservado local)`);
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

  const summary = await getLocalSyncSummary().catch(() => ({ sync_ok: 0, sync_error: 0, webhook_ok: 0, webhook_error: 0 }));

  await axios.post(`${centralUrl}/api/branches/heartbeat`, {
    branch_id:     branchId,
    last_poll_id:  lastPollId ?? 0,
    erp_connected: erpConnected,
    version:       process.env.npm_package_version || '1.0',
    hostname:      os.hostname(),
    sync_ok:       summary.sync_ok,
    sync_error:    summary.sync_error,
    webhook_ok:    summary.webhook_ok,
    webhook_error: summary.webhook_error,
  }, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 5_000,
  }).catch(() => {}); // heartbeat falla silencioso
}

const POLL_TIMEOUT_MS  = 120_000; // Guardián de seguridad: libera _isPolling si una vuelta tarda más de 120s

function getWebhookOperationTag(entidad, data) {
  if (entidad === 'articulo') return '[ACTUALIZACIÓN ARTÍCULO]';
  if (entidad === 'cliente')  return '[CREAR/ACTUALIZAR CLIENTE]';
  if (entidad === 'orders') {
    const sId = parseInt(data?.StatusId);
    const sName = String(data?.StatusName || '').toUpperCase().trim();
    if (sId === 11) return '[SOLO COTIZACIÓN -> cbcot/dtcot (StatusId 11)]';
    if (sId === 41) return '[PEDIDO + COTIZACIÓN -> cbpedvta (Distribuido=0, StatusId 41)]';
    if (sId === 38 || sId === 42) return `[PEDIDO LIBERADO -> cbpedvta (Distribuido=1, StatusId ${sId})]`;
    if (sId === 8 || sName.includes('CANCEL')) return '[CANCELACIÓN PEDIDO -> cbpedvta (Estatus=C, StatusId 8)]';
    if (sId === 7 || sName === 'INVOICED') return '[FACTURADO SAT -> cbpedvta (Campos SAT, StatusId 7)]';
    return `[OMITIDO EN PEDIDO -> StatusId ${sId} (${sName || 'N/A'})]`;
  }
  return `[${String(entidad).toUpperCase()}]`;
}

async function pollWebhooks() {
  if (_isPolling) return;
  _isPolling = true;

  const centralUrl = process.env.CENTRAL_URL;
  const branchId   = parseInt(process.env.PS_BRANCH_ID);
  const token      = process.env.PS_TOKEN;

  if (!centralUrl || !branchId) { _isPolling = false; return; }

  // Guardián: si en 120s la vuelta no termina, liberar el lock para no congelar la descarga de webhooks
  const safetyTimer = setTimeout(() => {
    console.warn('[WEBHOOK POLLER] ⚠ Timeout de seguridad alcanzado (120s), liberando lock _isPolling.');
    _isPolling = false;
  }, POLL_TIMEOUT_MS);

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
        const opTag = getWebhookOperationTag(rec.entidad, data);
        const displayKey = data?.OrderNumber || data?.SKU || data?.CustomerNumber || rec.clave_registro;
        console.log(`[WEBHOOK POLLER] 🏷️  #${rec.id} (${rec.entidad} / ${displayKey}) → ${opTag}`);
        try {
          const key = buildKey(rec.entidad, rec.clave_registro);
          if      (rec.entidad === 'articulo') await handleProductUpdate(key, data);
          else if (rec.entidad === 'cliente')  await handleCustomerUpdate(key, data);
          else if (rec.entidad === 'orders')   await handleOrderInsert(data);
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

    await setConfig('last_poll_at', new Date().toISOString());

    // Heartbeat after every poll cycle (even when no new records)
    await sendHeartbeat(maxId);

  } catch (err) {
    console.error('[WEBHOOK POLLER] Error al contactar maestro:', err.message);
  } finally {
    clearTimeout(safetyTimer);
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

module.exports = { startWebhookPoller, stopWebhookPoller, pollWebhooks, getWebhookOperationTag };
