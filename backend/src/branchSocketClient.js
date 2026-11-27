'use strict';
const WebSocket = require('ws');
const { query } = require('./db');
const { localQuery, getConfig, getFieldMapping } = require('./localdb');
const { mapArticuloalm } = require('./handlers/articuloalm');
const { pollWebhooks } = require('./webhookPoller');
const { getCentralToken } = require('./authMiddleware');

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

/**
 * Consulta en Magic ERP (cbpedvta / cbcot) y en webhook_logs locales de la sucursal
 * el estado actual de una lista de folios de PowerSales (orderNumbers).
 */
async function buildOrdersMagicData(params = {}) {
  const rawOrderNumbers = Array.isArray(params.orderNumbers) ? params.orderNumbers : [];
  const orderNumbers = Array.from(new Set(rawOrderNumbers.map(x => String(x || '').trim()).filter(Boolean)));

  const result = {
    pedidos: {},       // orderNumber -> { No_Pedido, IDPs, Cotizacion, Cve_Cte, Fech_Captura, Hora_Captura, Subtotal, Total, Estatus_Pedido, Distribuido, Moneda, Tipo_Cambio, IDMetodoPagoSAT, IDFormaPagoSAT, IDUsoCFDISAT, partidas }
    cotizaciones: {},  // orderNumber -> { No_Cotiza, IDPs, Cve_Cte, Fech_Captura, Hora_Captura, Subtotal, Total, Sync, Moneda, TC, partidas }
    branchLogs: {},    // orderNumber -> { id, estado, error_msg, fecha_recepcion }
    erpConnected: false,
    erpError: null,
  };

  if (orderNumbers.length === 0) return result;

  const [cabTableCfg, detTableCfg, cotCabTableCfg, cotDetTableCfg, fieldMapCab] = await Promise.all([
    getConfig('pedido_cabecera_table', 'cbpedvta').catch(() => 'cbpedvta'),
    getConfig('pedido_detalle_table', 'dtpedvta').catch(() => 'dtpedvta'),
    getConfig('cotizacion_cabecera_table', 'cbcot').catch(() => 'cbcot'),
    getConfig('cotizacion_detalle_table', 'dtcot').catch(() => 'dtcot'),
    getFieldMapping('pedido_cabecera').catch(() => ({})),
  ]);

  const cabTable = cabTableCfg || 'cbpedvta';
  const detTable = detTableCfg || 'dtpedvta';
  const cotCabTable = cotCabTableCfg || 'cbcot';
  const cotDetTable = cotDetTableCfg || 'dtcot';
  const mappedOrderCol = fieldMapCab['OrderNumber'] || 'IDPs';

  // 1. Consultar cbpedvta y cbcot en el ERP Magic
  try {
    const placeholders = orderNumbers.map(() => '?').join(', ');
    const whereCols = ['IDPs'];
    if (mappedOrderCol && mappedOrderCol.toLowerCase() !== 'idps') {
      whereCols.push(mappedOrderCol);
    }
    const whereSql = whereCols.map(c => `\`${c}\` IN (${placeholders})`).join(' OR ');
    const whereArgs = whereCols.flatMap(() => orderNumbers);

    // 1.A Pedidos en cbpedvta
    try {
      const [pedRows] = await query(
        `SELECT * FROM \`${cabTable}\` WHERE ${whereSql} ORDER BY No_Pedido DESC`,
        whereArgs
      );
      result.erpConnected = true;

      // Contar partidas en dtpedvta si hay pedidos encontrados
      const noPedidos = pedRows.map(r => r.No_Pedido).filter(Boolean);
      const partidasMap = {};
      if (noPedidos.length > 0 && detTable) {
        try {
          const pPlaceholders = noPedidos.map(() => '?').join(', ');
          const [cntRows] = await query(
            `SELECT No_Pedido, COUNT(*) as cnt FROM \`${detTable}\` WHERE No_Pedido IN (${pPlaceholders}) GROUP BY No_Pedido`,
            noPedidos
          );
          for (const c of cntRows) partidasMap[c.No_Pedido] = Number(c.cnt || 0);
        } catch (_) {}
      }

      for (const r of pedRows) {
        const key = String(r.IDPs || r[mappedOrderCol] || '').trim();
        if (!key || result.pedidos[key]) continue;
        result.pedidos[key] = {
          No_Pedido: r.No_Pedido,
          IDPs: r.IDPs ?? r[mappedOrderCol] ?? key,
          Cotizacion: r.Cotizacion ?? null,
          Cve_Cte: r.Cve_Cte ?? null,
          Fech_Captura: r.Fech_Captura ?? null,
          Hora_Captura: r.Hora_Captura ?? null,
          Subtotal: r.Subtotal !== undefined ? Number(r.Subtotal) : null,
          Total: r.Total !== undefined ? Number(r.Total) : null,
          Estatus_Pedido: r.Estatus_Pedido ?? null,
          Distribuido: r.Distribuido !== undefined && r.Distribuido !== null ? Number(r.Distribuido) : null,
          Moneda: r.Moneda ?? null,
          Tipo_Cambio: r.Tipo_Cambio ?? null,
          Condicion_Pago: r.Condicion_Pago ?? r.credito_contado ?? null,
          IDMetodoPagoSAT: r.IDMetodoPagoSAT ?? null,
          IDFormaPagoSAT: r.IDFormaPagoSAT ?? null,
          IDUsoCFDISAT: r.IDUsoCFDISAT ?? null,
          No_OC: r.No_OC ?? null,
          partidas: partidasMap[r.No_Pedido] ?? null,
        };
      }
    } catch (pedErr) {
      result.erpError = pedErr.message;
    }

    // 1.B Cotizaciones en cbcot
    try {
      const [cotRows] = await query(
        `SELECT * FROM \`${cotCabTable}\` WHERE IDPs IN (${placeholders}) ORDER BY No_Cotiza DESC`,
        orderNumbers
      );
      result.erpConnected = true;

      const noCotizas = cotRows.map(r => r.No_Cotiza).filter(Boolean);
      const cotPartidasMap = {};
      if (noCotizas.length > 0 && cotDetTable) {
        try {
          const cPlaceholders = noCotizas.map(() => '?').join(', ');
          const [cntRows] = await query(
            `SELECT N_Cotizacion, COUNT(*) as cnt FROM \`${cotDetTable}\` WHERE N_Cotizacion IN (${cPlaceholders}) GROUP BY N_Cotizacion`,
            noCotizas
          );
          for (const c of cntRows) cotPartidasMap[c.N_Cotizacion] = Number(c.cnt || 0);
        } catch (_) {}
      }

      for (const r of cotRows) {
        const key = String(r.IDPs || '').trim();
        if (!key || result.cotizaciones[key]) continue;
        result.cotizaciones[key] = {
          No_Cotiza: r.No_Cotiza,
          IDPs: r.IDPs,
          Cve_Cte: r.Cve_Cte ?? null,
          Fech_Captura: r.Fech_Captura ?? null,
          Hora_Captura: r.Hora_Captura ?? null,
          Subtotal: r.Subtotal !== undefined ? Number(r.Subtotal) : null,
          Total: r.Total !== undefined ? Number(r.Total) : null,
          Sync: r.Sync !== undefined && r.Sync !== null ? Number(r.Sync) : null,
          Moneda: r.Moneda ?? null,
          TC: r.TC ?? null,
          OC: r.OC ?? null,
          partidas: cotPartidasMap[r.No_Cotiza] ?? null,
        };
      }
    } catch (cotErr) {
      if (!result.erpError) result.erpError = cotErr.message;
    }
  } catch (erpErr) {
    result.erpError = erpErr.message;
  }

  // 2. Consultar últimos logs de aplicación en proteo_db local de la sucursal
  try {
    const orderSet = new Set(orderNumbers);
    const [logRows] = await localQuery(
      `SELECT id, clave_registro, datos, estado, error_msg, fecha_recepcion
       FROM webhook_logs
       WHERE entidad = 'orders'
       ORDER BY id DESC
       LIMIT 1000`
    );
    for (const r of logRows) {
      let folio = String(r.clave_registro || '').trim();
      if (!orderSet.has(folio) && r.datos) {
        try {
          const d = typeof r.datos === 'string' ? JSON.parse(r.datos) : r.datos;
          folio = String(d?.OrderNumber || d?.order?.OrderNumber || '').trim();
        } catch (_) {}
      }
      if (folio && orderSet.has(folio) && !result.branchLogs[folio]) {
        result.branchLogs[folio] = {
          id: r.id,
          estado: r.estado,
          error_msg: r.error_msg,
          fecha_recepcion: r.fecha_recepcion,
        };
      }
    }
  } catch (_) {}

  return result;
}

async function handleQuery(reqId, params) {
  try {
    const data = await buildInventoryData(params);
    ws.send(JSON.stringify({ type: 'query_inventory_result', reqId, ok: true, data }));
  } catch (err) {
    ws.send(JSON.stringify({ type: 'query_inventory_result', reqId, ok: false, error: err.message }));
  }
}

async function handleOrdersMagicQuery(reqId, params) {
  try {
    const data = await buildOrdersMagicData(params);
    ws.send(JSON.stringify({ type: 'query_orders_magic_result', reqId, ok: true, data }));
  } catch (err) {
    ws.send(JSON.stringify({ type: 'query_orders_magic_result', reqId, ok: false, error: err.message }));
  }
}

async function handleTriggerPoll(reqId) {
  try {
    await pollWebhooks();
    ws.send(JSON.stringify({ type: 'trigger_webhook_poll_result', reqId, ok: true, data: { polled: true } }));
  } catch (err) {
    ws.send(JSON.stringify({ type: 'trigger_webhook_poll_result', reqId, ok: false, error: err.message }));
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
  const tokens     = Array.from(new Set([getCentralToken(), process.env.PS_TOKEN].filter(Boolean)));
  const token      = tokens[attempt % tokens.length] || process.env.PS_TOKEN;

  const url = `${toWsUrl(centralUrl)}/branch-ws?branch_id=${branchId}&token=${encodeURIComponent(token)}`;
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
    } else if (msg.type === 'query_orders_magic' && msg.reqId) {
      handleOrdersMagicQuery(msg.reqId, msg.params || {});
    } else if (msg.type === 'trigger_webhook_poll' && msg.reqId) {
      handleTriggerPoll(msg.reqId);
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

module.exports = { startBranchSocketClient, stopBranchSocketClient, buildOrdersMagicData };
