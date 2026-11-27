'use strict';
const router = require('express').Router();
const ps = require('../src/powersales');
const { localQuery, getAllBranchStatuses, saveWebhookLog } = require('../src/localdb');
const branchSocket = require('../src/branchSocket');
const { buildOrdersMagicData } = require('../src/branchSocketClient');
const { broadcast } = require('../src/websocket');

// Estatus de PowerSales que deben existir en Magic (cbcot o cbpedvta)
const ACTIONABLE_STATUS_IDS = new Set([11, 41, 38, 42, 43, 6, 7, 8]);

/**
 * Descarga pedidos desde GET /orders de PowerSales (soporta múltiples páginas).
 */
async function fetchPowerSalesOrders(maxPages = 10) {
  const firstRes = await ps.get('/orders', { params: { page: 1 } });
  const firstData = Array.isArray(firstRes.data?.data)
    ? firstRes.data.data
    : (Array.isArray(firstRes.data) ? firstRes.data : []);
  const meta = firstRes.data?.meta || {};
  const lastPage = Math.min(Number(meta.last_page || 1), maxPages);

  const allOrders = [...firstData];

  if (lastPage > 1) {
    const pagePromises = [];
    for (let p = 2; p <= lastPage; p++) {
      pagePromises.push(
        ps.get('/orders', { params: { page: p } })
          .then(r => (Array.isArray(r.data?.data) ? r.data.data : []))
          .catch(() => [])
      );
    }
    const pagesData = await Promise.all(pagePromises);
    for (const arr of pagesData) {
      allOrders.push(...arr);
    }
  }

  return {
    orders: allOrders,
    meta: {
      totalPs: Number(meta.total || allOrders.length),
      pagesFetched: lastPage,
      totalPages: Number(meta.last_page || 1),
    },
  };
}

/**
 * Extrae el branchId de un objeto pedido de PowerSales.
 */
function extractOrderBranchId(order, fallbackBranchId = 9) {
  const rawBranch = order?.BranchId
    ?? order?.details_promo?.[0]?.order?.BranchId
    ?? order?.details_promo?.[0]?.order?.warehouse?.BranchId;
  if (rawBranch && typeof rawBranch === 'object' && rawBranch.Id) {
    return Number(rawBranch.Id);
  }
  if (rawBranch !== undefined && rawBranch !== null && rawBranch !== '' && !isNaN(Number(rawBranch))) {
    return Number(rawBranch);
  }
  return fallbackBranchId;
}

/**
 * Determina qué tabla/estatus debería tener Magic según el StatusId de PowerSales.
 */
function getExpectedMagicState(statusId, statusName = '') {
  const sId = Number(statusId);
  const sName = String(statusName || '').toUpperCase().trim();

  if (sId === 11) {
    return {
      target: 'cbcot',
      actionable: true,
      expectedLabel: 'Cotización en cbcot',
    };
  }
  if (sId === 41) {
    return {
      target: 'cbpedvta',
      actionable: true,
      expectedDistribuido: 0,
      expectedLabel: 'Pedido en cbpedvta (Distribuido = 0)',
    };
  }
  if (sId === 38 || sId === 42) {
    return {
      target: 'cbpedvta',
      actionable: true,
      expectedDistribuido: 1,
      expectedLabel: 'Pedido Liberado en cbpedvta (Distribuido = 1)',
    };
  }
  if (sId === 43 || sId === 6) {
    return {
      target: 'cbpedvta',
      actionable: true,
      expectedLabel: `Pedido Surtido en cbpedvta (${sId === 43 ? 'Completo' : 'Parcial'})`,
    };
  }
  if (sId === 7 || sName === 'INVOICED') {
    return {
      target: 'cbpedvta',
      actionable: true,
      requireSat: true,
      expectedLabel: 'Pedido Facturado en cbpedvta (Datos SAT)',
    };
  }
  if (sId === 8 || sName.includes('CANCEL')) {
    return {
      target: 'cbpedvta',
      actionable: true,
      expectedEstatusPedido: 'C',
      expectedLabel: 'Pedido Cancelado en cbpedvta (Estatus = C)',
    };
  }

  return {
    target: 'none',
    actionable: ACTIONABLE_STATUS_IDS.has(sId),
    expectedLabel: `Omitido en Magic (St ${sId} · ${sName || 'Borrador'})`,
  };
}

/**
 * Evalúa el diagnóstico comparando PowerSales vs Magic vs Cola de Webhooks.
 */
function evaluateOrderSync({ psOrder, magicPedido, magicCotizacion, masterWebhook, branchLog, branchInfo, magicReachable }) {
  const sId = Number(psOrder.statusId);
  const sName = String(psOrder.statusName || '').toUpperCase().trim();
  const expected = getExpectedMagicState(sId, sName);

  const lastPollId = Number(branchInfo?.last_poll_id || 0);
  const isPendingInQueue = Boolean(masterWebhook && masterWebhook.id > lastPollId);

  // Si no pudimos consultar Magic ni por WS ni por BD local
  if (!magicReachable) {
    if (isPendingInQueue) {
      return {
        code: 'PENDING_QUEUE',
        label: 'Pendiente en Cola',
        severity: 'warning',
        detail: `Webhook #${masterWebhook.id} en Maestro esperando pull de Sucursal ${psOrder.branchId} (último pull: #${lastPollId})`,
        expectedLabel: expected.expectedLabel,
        needsAction: false,
      };
    }
    return {
      code: 'BRANCH_UNREACHABLE',
      label: 'Sucursal sin conexión',
      severity: 'neutral',
      detail: `No se pudo verificar Magic en Sucursal ${psOrder.branchId} (túnel WS desconectado)`,
      expectedLabel: expected.expectedLabel,
      needsAction: false,
    };
  }

  // Caso 1: Estatus de PowerSales NO requiere inserción en Magic (ej. 1 DRAFT, 3 SIN DEFINIR)
  if (!expected.actionable) {
    if (magicPedido || magicCotizacion) {
      return {
        code: 'SYNC_OK',
        label: 'En Magic',
        severity: 'ok',
        detail: magicPedido
          ? `Existe en cbpedvta (No_Pedido: ${magicPedido.No_Pedido}) aunque en PS está en St ${sId} (${sName})`
          : `Existe en cbcot (No_Cotiza: ${magicCotizacion.No_Cotiza})`,
        expectedLabel: expected.expectedLabel,
        needsAction: false,
      };
    }
    return {
      code: 'DRAFT_OMITTED',
      label: 'Borrador / Omitido',
      severity: 'neutral',
      detail: `Estatus ${sId} (${sName || 'SIN DEFINIR'}) en PowerSales no se inserta en Magic hasta pasar a Cotización (11) o Pedido (38/41)`,
      expectedLabel: expected.expectedLabel,
      needsAction: false,
    };
  }

  // Caso 2: Estatus 11 (Solo Cotización en cbcot)
  if (expected.target === 'cbcot') {
    if (magicCotizacion) {
      return {
        code: 'SYNC_OK',
        label: 'Sincronizado (Cotización)',
        severity: 'ok',
        detail: `Cotización registrada en cbcot con No_Cotiza #${magicCotizacion.No_Cotiza}`,
        expectedLabel: expected.expectedLabel,
        needsAction: false,
      };
    }
    if (isPendingInQueue) {
      return {
        code: 'PENDING_QUEUE',
        label: 'Pendiente en Cola',
        severity: 'warning',
        detail: `Webhook #${masterWebhook.id} pendiente de ser jalado por Sucursal ${psOrder.branchId}`,
        expectedLabel: expected.expectedLabel,
        needsAction: true,
      };
    }
    const errReason = branchLog?.estado === 2
      ? `Error en Sucursal: ${branchLog.error_msg}`
      : (!masterWebhook ? 'PowerSales no envió el webhook al Maestro' : 'Webhook procesado pero no se encontró en cbcot');
    return {
      code: 'MISSING_IN_MAGIC',
      label: 'Falta en Magic (cbcot)',
      severity: 'error',
      detail: errReason,
      expectedLabel: expected.expectedLabel,
      needsAction: true,
    };
  }

  // Caso 3: Estatus de Pedido (target === 'cbpedvta': 41, 38, 42, 43, 6, 7, 8)
  if (!magicPedido) {
    // ¿Existe sólo como cotización en cbcot pero aún no pasa a cbpedvta?
    if (magicCotizacion) {
      if (isPendingInQueue) {
        return {
          code: 'PENDING_QUEUE',
          label: 'Pendiente Paso a Pedido',
          severity: 'warning',
          detail: `Está en cbcot (#${magicCotizacion.No_Cotiza}). Webhook #${masterWebhook.id} (St ${sId}) pendiente de jalar para crear pedido en cbpedvta`,
          expectedLabel: expected.expectedLabel,
          needsAction: true,
        };
      }
      return {
        code: 'STATUS_MISMATCH',
        label: 'Desfasado (Sólo en cbcot)',
        severity: 'error',
        detail: `En PS ya es Pedido (St ${sId} ${sName}), pero en Magic sólo existe como Cotización #${magicCotizacion.No_Cotiza} y falta en cbpedvta`,
        expectedLabel: expected.expectedLabel,
        needsAction: true,
      };
    }

    // No existe ni en cbpedvta ni en cbcot
    if (isPendingInQueue) {
      return {
        code: 'PENDING_QUEUE',
        label: 'Pendiente en Cola',
        severity: 'warning',
        detail: `Webhook #${masterWebhook.id} en cola del Maestro esperando pull de Sucursal ${psOrder.branchId}`,
        expectedLabel: expected.expectedLabel,
        needsAction: true,
      };
    }

    // Si en PS está Cancelado (8) y nunca existió en cbpedvta, puede que se haya cancelado antes de ser pedido
    const errReason = branchLog?.estado === 2
      ? `Error en Sucursal: ${branchLog.error_msg}`
      : (!masterWebhook
          ? 'En PowerSales pero nunca llegó webhook al Maestro'
          : 'El webhook fue jalado por la sucursal pero el pedido no existe en cbpedvta');

    return {
      code: 'MISSING_IN_MAGIC',
      label: 'En PS pero NO en Magic',
      severity: 'error',
      detail: errReason,
      expectedLabel: expected.expectedLabel,
      needsAction: true,
    };
  }

  // El pedido SÍ existe en cbpedvta — verificar que su estatus/distribuido en Magic coincida con PowerSales
  const magicEstatus = String(magicPedido.Estatus_Pedido || '').toUpperCase().trim();
  const magicDist = magicPedido.Distribuido !== null && magicPedido.Distribuido !== undefined
    ? Number(magicPedido.Distribuido)
    : null;

  // Validar Cancelación (StatusId 8)
  if (expected.expectedEstatusPedido === 'C' && magicEstatus !== 'C') {
    return {
      code: isPendingInQueue ? 'PENDING_QUEUE' : 'STATUS_MISMATCH',
      label: isPendingInQueue ? 'Cancelación en Cola' : 'Desfasado (No Cancelado en Magic)',
      severity: isPendingInQueue ? 'warning' : 'error',
      detail: `En PS está CANCELADO (St 8), pero en cbpedvta (#${magicPedido.No_Pedido}) tiene Estatus_Pedido='${magicEstatus || 'P'}'`,
      expectedLabel: expected.expectedLabel,
      needsAction: true,
    };
  }

  // Validar Distribuido (StatusId 41 -> 0, StatusId 38/42 -> 1)
  if (expected.expectedDistribuido !== undefined && magicDist !== null && magicDist !== expected.expectedDistribuido) {
    return {
      code: isPendingInQueue ? 'PENDING_QUEUE' : 'STATUS_MISMATCH',
      label: isPendingInQueue ? 'Actualización en Cola' : `Desfasado (Distribuido=${magicDist})`,
      severity: isPendingInQueue ? 'warning' : 'error',
      detail: `En PS es St ${sId} (${sName}) que requiere Distribuido=${expected.expectedDistribuido}, pero en cbpedvta (#${magicPedido.No_Pedido}) tiene Distribuido=${magicDist}`,
      expectedLabel: expected.expectedLabel,
      needsAction: true,
    };
  }

  // Validar Facturado SAT (StatusId 7 / INVOICED)
  if (expected.requireSat && !magicPedido.IDMetodoPagoSAT && !magicPedido.IDFormaPagoSAT && !magicPedido.IDUsoCFDISAT) {
    return {
      code: isPendingInQueue ? 'PENDING_QUEUE' : 'STATUS_MISMATCH',
      label: isPendingInQueue ? 'Datos SAT en Cola' : 'Desfasado (Faltan Datos SAT)',
      severity: isPendingInQueue ? 'warning' : 'error',
      detail: `En PS está INVOICED (St 7), pero en cbpedvta (#${magicPedido.No_Pedido}) aún no tiene IDMetodoPagoSAT / IDFormaPagoSAT / IDUsoCFDISAT`,
      expectedLabel: expected.expectedLabel,
      needsAction: true,
    };
  }

  return {
    code: 'SYNC_OK',
    label: 'Sincronizado en Magic',
    severity: 'ok',
    detail: `En cbpedvta No_Pedido #${magicPedido.No_Pedido} (Estatus: ${magicEstatus || '—'}, Dist: ${magicDist ?? '—'})`,
    expectedLabel: expected.expectedLabel,
    needsAction: false,
  };
}

/**
 * GET /api/reconciliation/orders
 * Consulta GET /orders en PowerSales, cruza contra webhook_logs del Maestro
 * y consulta en tiempo real a cada sucursal (vía /branch-ws o fallback local) para
 * saber qué pedidos están en PS pero no en Magic, cuáles están pendientes y sus estatus.
 */
router.get('/orders', async (req, res) => {
  try {
    const maxPages = Math.max(1, Math.min(parseInt(req.query.max_pages) || 10, 30));

    // 1. Obtener pedidos de PowerSales API, estados de sucursales y logs del Maestro en paralelo
    const [psResult, branchStatuses, [masterLogs]] = await Promise.all([
      fetchPowerSalesOrders(maxPages),
      getAllBranchStatuses().catch(() => []),
      localQuery(
        `SELECT id, entidad, clave_registro, datos, estado, error_msg, branch_id, fecha_recepcion
         FROM webhook_logs
         WHERE entidad = 'orders'
         ORDER BY id DESC
         LIMIT 2500`
      ).catch(() => [[]]),
    ]);

    const defaultBranchId = branchStatuses[0]?.branch_id
      || (process.env.PS_BRANCH_ID ? parseInt(process.env.PS_BRANCH_ID) : 9);

    // Indexar sucursales por branch_id
    const branchMap = new Map();
    const now = Date.now();
    for (const b of branchStatuses) {
      const heartbeatOnline = b.last_seen_at ? (now - new Date(b.last_seen_at).getTime()) < 2 * 60 * 1000 : false;
      const wsOnline = branchSocket.isBranchOnline(b.branch_id);
      branchMap.set(Number(b.branch_id), {
        ...b,
        online: heartbeatOnline || wsOnline,
        wsOnline,
      });
    }

    // Indexar webhook_logs del Maestro por OrderNumber
    const masterWebhookMap = new Map();
    for (const row of masterLogs) {
      let parsed = null;
      try {
        parsed = typeof row.datos === 'string' ? JSON.parse(row.datos) : row.datos;
      } catch (_) {}
      const orderNum = String(
        parsed?.OrderNumber ||
        parsed?.order?.OrderNumber ||
        row.clave_registro ||
        ''
      ).replace(/^"+|"+$/g, '').trim();

      if (!orderNum) continue;

      if (!masterWebhookMap.has(orderNum)) {
        masterWebhookMap.set(orderNum, {
          id: row.id,
          estado: row.estado,
          error_msg: row.error_msg,
          branch_id: row.branch_id ? Number(row.branch_id) : null,
          fecha_recepcion: row.fecha_recepcion,
          lastPsStatusId: parsed?.StatusId ?? parsed?.order?.StatusId ?? null,
          lastPsStatusName: parsed?.StatusName ?? parsed?.order?.StatusName ?? null,
          count: 1,
        });
      } else {
        masterWebhookMap.get(orderNum).count += 1;
      }
    }

    // 2. Normalizar pedidos de PowerSales y agrupar por branchId para consultar Magic
    const normalizedOrders = [];
    const ordersByBranch = new Map();

    for (const raw of psResult.orders) {
      const orderNumber = String(raw.OrderNumber || '').trim();
      if (!orderNumber) continue;

      const mLog = masterWebhookMap.get(orderNumber) || null;
      const branchId = extractOrderBranchId(raw, mLog?.branch_id || defaultBranchId);

      const details = Array.isArray(raw.details) ? raw.details : [];
      const promoOrder = raw.details_promo?.[0]?.order || {};
      const warehouseName = promoOrder?.warehouse?.Name || details[0]?.Warehouse || '—';
      const currency = raw.Currency || promoOrder.Currency || 'MXN';
      const purchaseOrder = raw.PurchaseOrderNumber || promoOrder.PurchaseOrderNumber || '';

      const item = {
        psId: raw.Id,
        orderNumber,
        branchId,
        warehouseName,
        statusId: Number(raw.StatusId),
        statusName: raw.StatusName || 'SIN DEFINIR',
        orderDate: raw.OrderDate || null,
        deliveryDate: raw.DeliveryDate || null,
        createdDate: raw.CreatedDate || null,
        modifiedDate: raw.ModifiedDate || null,
        totalAmount: Number(raw.TotalAmount || 0),
        totalQty: Number(raw.TotalQty || 0),
        paymentType: raw.PaymentType || promoOrder.PaymentType || '—',
        orderType: raw.OrderType || promoOrder.OrderType || '—',
        typeSend: raw.TypeSend || promoOrder.TypeSend || '—',
        currency,
        purchaseOrder,
        itemsCount: details.length,
        customer: {
          id: raw.CustomerId?.Id ?? null,
          number: raw.CustomerId?.CustomerNumber ?? '—',
          name: raw.CustomerId?.Name ?? '—',
          tin: raw.CustomerId?.TIN ?? '—',
        },
        rep: {
          id: raw.RepId?.Id ?? null,
          number: raw.RepId?.EmployeeNumber ?? '—',
          name: raw.RepId?.UserName || raw.RepId?.FirstName || '—',
        },
        route: {
          id: raw.RouteId?.Id ?? null,
          name: raw.RouteId?.Name ?? '—',
        },
        rawPayload: raw,
      };

      normalizedOrders.push(item);

      if (!ordersByBranch.has(branchId)) {
        ordersByBranch.set(branchId, []);
      }
      ordersByBranch.get(branchId).push(orderNumber);
    }

    // 3. Consultar Magic en cada sucursal involucrada (vía WebSocket /branch-ws o fallback BD local)
    const magicByBranch = new Map();
    await Promise.all(
      Array.from(ordersByBranch.entries()).map(async ([branchId, orderNumbers]) => {
        // Primero intentar por túnel WebSocket hacia la sucursal
        if (branchSocket.isBranchOnline(branchId)) {
          try {
            const wsData = await branchSocket.sendOrdersMagicQuery(branchId, { orderNumbers }, 12_000);
            magicByBranch.set(branchId, {
              ...wsData,
              source: 'branch_ws',
              reachable: Boolean(wsData && wsData.erpConnected !== false),
            });
            return;
          } catch (wsErr) {
            console.warn(`[RECONCILIATION] Falló query WS a branch ${branchId}:`, wsErr.message);
          }
        }

        // Fallback: intentar conexión directa a BD ERP si el servidor actual tiene acceso
        try {
          const localData = await buildOrdersMagicData({ orderNumbers });
          if (localData.erpConnected) {
            magicByBranch.set(branchId, {
              ...localData,
              source: 'local_db',
              reachable: true,
            });
            return;
          }
        } catch (_) {}

        magicByBranch.set(branchId, {
          pedidos: {},
          cotizaciones: {},
          branchLogs: {},
          source: 'offline',
          reachable: false,
        });
      })
    );

    // 4. Armar resultado final con diagnóstico por cada pedido
    const summary = {
      totalPs: normalizedOrders.length,
      syncOk: 0,
      missingInMagic: 0,
      statusMismatch: 0,
      pendingQueue: 0,
      draftOmitted: 0,
      branchUnreachable: 0,
    };

    const rows = normalizedOrders.map(psOrder => {
      const bMagic = magicByBranch.get(psOrder.branchId) || {
        pedidos: {},
        cotizaciones: {},
        branchLogs: {},
        source: 'offline',
        reachable: false,
      };
      const magicPedido = bMagic.pedidos?.[psOrder.orderNumber] || null;
      const magicCotizacion = bMagic.cotizaciones?.[psOrder.orderNumber] || null;
      const branchLog = bMagic.branchLogs?.[psOrder.orderNumber] || null;
      const masterWebhook = masterWebhookMap.get(psOrder.orderNumber) || null;
      const branchInfo = branchMap.get(psOrder.branchId) || {
        branch_id: psOrder.branchId,
        last_poll_id: 0,
        online: branchSocket.isBranchOnline(psOrder.branchId),
        wsOnline: branchSocket.isBranchOnline(psOrder.branchId),
      };

      const diagnosis = evaluateOrderSync({
        psOrder,
        magicPedido,
        magicCotizacion,
        masterWebhook,
        branchLog,
        branchInfo,
        magicReachable: bMagic.reachable,
      });

      if (diagnosis.code === 'SYNC_OK') summary.syncOk++;
      else if (diagnosis.code === 'MISSING_IN_MAGIC') summary.missingInMagic++;
      else if (diagnosis.code === 'STATUS_MISMATCH') summary.statusMismatch++;
      else if (diagnosis.code === 'PENDING_QUEUE') summary.pendingQueue++;
      else if (diagnosis.code === 'DRAFT_OMITTED') summary.draftOmitted++;
      else if (diagnosis.code === 'BRANCH_UNREACHABLE') summary.branchUnreachable++;

      const { rawPayload, ...cleanOrder } = psOrder;
      return {
        ...cleanOrder,
        magic: {
          reachable: bMagic.reachable,
          source: bMagic.source,
          pedido: magicPedido,
          cotizacion: magicCotizacion,
        },
        webhook: {
          master: masterWebhook,
          branch: branchLog,
          branchLastPollId: Number(branchInfo.last_poll_id || 0),
          isPendingPull: Boolean(masterWebhook && masterWebhook.id > Number(branchInfo.last_poll_id || 0)),
        },
        diagnosis,
      };
    });

    // Ordenar por fecha de modificación o ID descendente
    rows.sort((a, b) => (Number(b.psId || 0) - Number(a.psId || 0)));

    const branchesSummary = Array.from(ordersByBranch.keys()).map(bId => {
      const bInfo = branchMap.get(bId);
      const bMagic = magicByBranch.get(bId);
      return {
        branch_id: bId,
        hostname: bInfo?.hostname || `Sucursal ${bId}`,
        online: Boolean(bInfo?.online),
        wsOnline: branchSocket.isBranchOnline(bId),
        last_poll_id: Number(bInfo?.last_poll_id || 0),
        magicReachable: Boolean(bMagic?.reachable),
        magicSource: bMagic?.source || 'offline',
      };
    });

    res.json({
      ok: true,
      summary,
      meta: psResult.meta,
      branches: branchesSummary,
      data: rows,
    });
  } catch (err) {
    console.error('[RECONCILIATION GET /orders] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/reconciliation/resync
 * Re-encola uno o varios pedidos desde el GET /orders de PowerSales hacia la cola de webhooks
 * del Maestro para su sucursal, y si la sucursal está conectada por WS, dispara su poll de inmediato.
 */
router.post('/resync', async (req, res) => {
  try {
    const { orderNumbers, maxPages = 10 } = req.body || {};
    const targetList = Array.isArray(orderNumbers)
      ? orderNumbers.map(x => String(x || '').trim()).filter(Boolean)
      : [];

    if (targetList.length === 0) {
      return res.status(400).json({ ok: false, error: 'Se requiere al menos un OrderNumber en orderNumbers' });
    }

    const targetSet = new Set(targetList);
    const { orders } = await fetchPowerSalesOrders(maxPages);
    const branchStatuses = await getAllBranchStatuses().catch(() => []);
    const defaultBranchId = branchStatuses[0]?.branch_id
      || (process.env.PS_BRANCH_ID ? parseInt(process.env.PS_BRANCH_ID) : 9);

    const matchedOrders = orders.filter(o => targetSet.has(String(o.OrderNumber || '').trim()));
    if (matchedOrders.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'No se encontraron los pedidos solicitados en PowerSales GET /orders',
      });
    }

    const enqueued = [];
    const branchesToTrigger = new Set();

    for (const orderData of matchedOrders) {
      const orderNum = String(orderData.OrderNumber).trim();
      const branchId = extractOrderBranchId(orderData, defaultBranchId);

      await saveWebhookLog(
        'orders',
        orderNum,
        orderData,
        1,
        `[RE-SYNC MANUAL MAESTRO] Encolado desde Conciliación (St ${orderData.StatusId} · ${orderData.StatusName || ''})`,
        branchId
      );

      broadcast('webhook_received', {
        entidad: 'orders',
        clave_registro: orderNum,
        estado: 1,
        branch_id: branchId,
        fecha_recepcion: new Date().toISOString(),
      });

      enqueued.push({
        orderNumber: orderNum,
        branchId,
        statusId: orderData.StatusId,
        statusName: orderData.StatusName,
      });
      branchesToTrigger.add(branchId);
    }

    // Si la sucursal está conectada por WebSocket, disparar su descarga inmediata
    const triggeredBranches = [];
    for (const bId of branchesToTrigger) {
      if (branchSocket.isBranchOnline(bId)) {
        try {
          await branchSocket.sendTriggerPoll(bId, 15_000);
          triggeredBranches.push(bId);
        } catch (err) {
          console.warn(`[RECONCILIATION RESYNC] Poll inmediato en branch ${bId} no respondió a tiempo:`, err.message);
        }
      }
    }

    res.json({
      ok: true,
      message: `${enqueued.length} pedido(s) encolado(s) para sincronización a Magic`,
      enqueued,
      triggeredBranches,
    });
  } catch (err) {
    console.error('[RECONCILIATION POST /resync] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;

