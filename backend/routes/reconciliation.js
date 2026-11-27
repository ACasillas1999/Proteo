'use strict';
const router = require('express').Router();
const ps = require('../src/powersales');
const { localQuery, getAllBranchStatuses, getConfig, saveWebhookLog } = require('../src/localdb');
const branchSocket = require('../src/branchSocket');
const { buildOrdersMagicData } = require('../src/branchSocketClient');
const { broadcast } = require('../src/websocket');

// Estatus donde el documento ya DEBE existir como Pedido en cbpedvta
const ORDER_REQUIRED_STATUS_IDS = new Set([41, 38, 42, 43, 6, 7]);

/**
 * Descarga pedidos desde GET /orders de PowerSales (soporta múltiples páginas).
 * Nota: GET /orders en PowerSales devuelve principalmente los pedidos en Borrador (StatusId 1 / IsSync 2).
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
      totalPsGet: Number(meta.total || allOrders.length),
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
 * Explica claramente la regla de negocio para cada StatusId de PowerSales:
 * cuándo es normal que NO esté en Magic y cuándo SÍ debe existir en cbcot y/o cbpedvta.
 */
function getBusinessRuleForStatus(statusId, statusName = '', statusHistory = []) {
  const sId = Number(statusId);
  const sName = String(statusName || '').toUpperCase().trim();
  const wasEverOrder = statusHistory.some(st => ORDER_REQUIRED_STATUS_IDS.has(Number(st)));

  if (sId === 11) {
    return {
      ruleType: 'QUOTE_ONLY',
      mustExistInCbcot: true,
      mustExistInCbpedvta: false,
      ruleTitle: 'Debe existir en cbcot (Normal que NO esté en cbpedvta)',
      ruleDescription: 'Estatus 11 (Cotización): Se guarda únicamente en cbcot. Es normal que aún no tenga pedido en cbpedvta.',
    };
  }

  if (sId === 41) {
    return {
      ruleType: 'ORDER_CREATED',
      mustExistInCbcot: true,
      mustExistInCbpedvta: true,
      ruleTitle: 'Debe existir en cbpedvta (Pedido) y cbcot',
      ruleDescription: 'Estatus 41 (ORDER_CREATED): Ya debe existir en cbpedvta (inicia con Distribuido=0) y en cbcot.',
    };
  }

  if (sId === 38 || sId === 42) {
    return {
      ruleType: 'ORDER_RELEASED',
      mustExistInCbcot: true,
      mustExistInCbpedvta: true,
      requireDistribuido1: true,
      ruleTitle: 'Debe existir en cbpedvta con Distribuido = 1',
      ruleDescription: `Estatus ${sId} (${sName || 'Liberado'}): Ya debe existir en cbpedvta liberado (Distribuido = 1).`,
    };
  }

  if (sId === 43 || sId === 6) {
    return {
      ruleType: 'ORDER_PICKED',
      mustExistInCbcot: false,
      mustExistInCbpedvta: true,
      ruleTitle: 'Debe existir en cbpedvta (Surtido desde Magic)',
      ruleDescription: `Estatus ${sId} (${sName}): Surtido reportado por Magic; debe existir en cbpedvta.`,
    };
  }

  if (sId === 7 || sName === 'INVOICED') {
    return {
      ruleType: 'ORDER_INVOICED',
      mustExistInCbcot: false,
      mustExistInCbpedvta: true,
      requireSat: true,
      ruleTitle: 'Debe existir en cbpedvta con Datos SAT',
      ruleDescription: 'Estatus 7 (INVOICED): Debe existir en cbpedvta y tener sus campos SAT (Método/Forma/Uso CFDI).',
    };
  }

  if (sId === 8 || sName.includes('CANCEL')) {
    if (wasEverOrder) {
      return {
        ruleType: 'CANCELLED_AFTER_ORDER',
        mustExistInCbcot: false,
        mustExistInCbpedvta: true,
        requireCancelledInMagic: true,
        ruleTitle: 'Debe estar Cancelado (Estatus_Pedido = C) en cbpedvta',
        ruleDescription: 'Estatus 8 (CANCELLED): Como antes ya había sido Pedido (St 41/38/42), en cbpedvta debe tener Estatus_Pedido = C.',
      };
    }
    return {
      ruleType: 'CANCELLED_BEFORE_ORDER',
      mustExistInCbcot: false,
      mustExistInCbpedvta: false,
      requireCancelledInMagic: true,
      ruleTitle: 'Normal que NO exista en Magic (Cancelado antes de ser Pedido)',
      ruleDescription: 'Estatus 8 (CANCELLED): Se canceló en PowerSales sin haber pasado a Pedido (38/41/42), por lo que es normal que no exista en cbpedvta.',
    };
  }

  // Estatus 1 (DRAFT), 3 (SIN DEFINIR), 35, 36, 37, 39, 46, etc.
  return {
    ruleType: 'NORMAL_NOT_IN_MAGIC',
    mustExistInCbcot: false,
    mustExistInCbpedvta: false,
    ruleTitle: 'Normal que NO exista en Magic (Borrador / Previo en PS)',
    ruleDescription: `Estatus ${sId} (${sName || 'Borrador'}): Etapa previa en PowerSales. Es completamente normal que no se envíe a Magic hasta pasar a Cotización (11) o Pedido (41/38/42).`,
  };
}

/**
 * Evalúa si el estado entre PowerSales y Magic es:
 * - SYNC_OK (Verde: Existe en Magic donde debe estar y con estatus correcto)
 * - NORMAL_OMITTED (Gris/Azul Neutro: Es NORMAL que NO esté en Magic por su estatus en PS)
 * - PENDING_QUEUE (Ámbar: Webhook en cola esperando pull de sucursal; aún no es error)
 * - ERROR_MISSING (ROJO: ERROR REAL — Por su estatus YA DEBERÍA existir en Magic y NO existe)
 * - ERROR_MISMATCH (ROJO: ERROR REAL — Existe en Magic pero su estatus/datos en Magic están mal o falló su actualización)
 */
function evaluateOrderSync({
  psOrder,
  magicPedido,
  magicCotizacion,
  masterWebhook,
  branchLog,
  branchInfo,
  magicReachable,
}) {
  const sId = Number(psOrder.statusId);
  const sName = String(psOrder.statusName || '').toUpperCase().trim();
  const statusHistory = Array.isArray(psOrder.statusHistory) ? psOrder.statusHistory : [sId];
  const rule = getBusinessRuleForStatus(sId, sName, statusHistory);

  const lastPollId = Number(branchInfo?.last_poll_id || 0);
  const isPendingInQueue = Boolean(masterWebhook && masterWebhook.id > lastPollId);
  const hasBranchDbError = Boolean(branchLog && Number(branchLog.estado) === 2);

  // 0. Si la sucursal está desconectada y no pudimos verificar Magic
  if (!magicReachable) {
    if (isPendingInQueue) {
      return {
        code: 'PENDING_QUEUE',
        isError: false,
        label: 'En Cola (Esperando Pull)',
        detail: `Webhook #${masterWebhook.id} en Maestro esperando descarga de Sucursal ${psOrder.branchId}.`,
        ruleTitle: rule.ruleTitle,
        ruleDescription: rule.ruleDescription,
        needsAction: false,
      };
    }
    return {
      code: 'BRANCH_UNREACHABLE',
      isError: false,
      label: 'Sucursal Sin Conexión WS',
      detail: `No se pudo consultar Magic en Sucursal ${psOrder.branchId} en este momento.`,
      ruleTitle: rule.ruleTitle,
      ruleDescription: rule.ruleDescription,
      needsAction: false,
    };
  }

  // 1. Estatus donde ES NORMAL que NO exista en Magic (St 1 DRAFT, St 3, St 35..37, o St 8 cancelado antes de ser pedido)
  if (rule.ruleType === 'NORMAL_NOT_IN_MAGIC' || rule.ruleType === 'CANCELLED_BEFORE_ORDER') {
    // Si es un cancelado que sí llegó a existir en cbpedvta, verificar que en cbpedvta esté en 'C'
    if (rule.ruleType === 'CANCELLED_BEFORE_ORDER' && magicPedido) {
      const est = String(magicPedido.Estatus_Pedido || '').toUpperCase().trim();
      if (est !== 'C') {
        return {
          code: isPendingInQueue ? 'PENDING_QUEUE' : 'ERROR_MISMATCH',
          isError: !isPendingInQueue,
          label: isPendingInQueue ? 'Cancelación en Cola' : 'Error: No Cancelado en Magic',
          detail: `En PowerSales está CANCELADO (St 8), pero en cbpedvta (#${magicPedido.No_Pedido}) sigue con Estatus_Pedido='${est || 'P'}'.`,
          ruleTitle: 'Debe tener Estatus_Pedido = C en cbpedvta',
          ruleDescription: rule.ruleDescription,
          needsAction: true,
        };
      }
      return {
        code: 'SYNC_OK',
        isError: false,
        label: 'Correcto (Cancelado en Magic)',
        detail: `Cancelado correctamente en cbpedvta (#${magicPedido.No_Pedido}, Estatus = C).`,
        ruleTitle: rule.ruleTitle,
        ruleDescription: rule.ruleDescription,
        needsAction: false,
      };
    }

    // Si en PS regresó a Borrador (1) después de haber sido Cotización (11), es normal que tenga su cotización en cbcot
    if (magicCotizacion && !magicPedido) {
      return {
        code: 'NORMAL_OMITTED',
        isError: false,
        label: 'Normal: En Borrador PS (Con Cotización previa)',
        detail: `Actualmente en St ${sId} (${sName}) en PowerSales. Conserva su cotización previa #${magicCotizacion.No_Cotiza} en cbcot y es normal que no esté en cbpedvta.`,
        ruleTitle: rule.ruleTitle,
        ruleDescription: rule.ruleDescription,
        needsAction: false,
      };
    }

    return {
      code: 'NORMAL_OMITTED',
      isError: false,
      label: rule.ruleType === 'CANCELLED_BEFORE_ORDER'
        ? 'Normal: Cancelado sin Pedido'
        : 'Normal: No aplica en Magic aún',
      detail: rule.ruleDescription,
      ruleTitle: rule.ruleTitle,
      ruleDescription: rule.ruleDescription,
      needsAction: false,
    };
  }

  // 2. Estatus 11: DEBE existir en cbcot, y ES NORMAL que NO exista en cbpedvta
  if (rule.ruleType === 'QUOTE_ONLY') {
    if (magicCotizacion) {
      return {
        code: 'SYNC_OK',
        isError: false,
        label: 'Correcto: Cotización en cbcot',
        detail: `Existe en cbcot (#${magicCotizacion.No_Cotiza}). Es normal que no exista en cbpedvta porque en PS sigue en Estatus 11 (Cotización).`,
        ruleTitle: rule.ruleTitle,
        ruleDescription: rule.ruleDescription,
        needsAction: false,
      };
    }
    if (isPendingInQueue) {
      return {
        code: 'PENDING_QUEUE',
        isError: false,
        label: 'Cotización en Cola',
        detail: `Webhook #${masterWebhook.id} (St 11) pendiente de ser jalado por Sucursal ${psOrder.branchId} para crear cotización en cbcot.`,
        ruleTitle: rule.ruleTitle,
        ruleDescription: rule.ruleDescription,
        needsAction: true,
      };
    }
    return {
      code: 'ERROR_MISSING',
      isError: true,
      label: 'Error: Falta Cotización en cbcot',
      detail: hasBranchDbError
        ? `Debía crearse en cbcot (St 11) pero falló en Sucursal: ${branchLog.error_msg}`
        : 'En PowerSales está en Estatus 11 (Cotización), por lo que ya debería existir en cbcot y no se encontró.',
      ruleTitle: rule.ruleTitle,
      ruleDescription: rule.ruleDescription,
      needsAction: true,
    };
  }

  // 3. Estatus 8 (Cancelado después de haber sido pedido 41/38/42)
  if (rule.ruleType === 'CANCELLED_AFTER_ORDER') {
    if (!magicPedido) {
      // Nunca se llegó a crear en cbpedvta y ya está cancelado en PS
      return {
        code: 'NORMAL_OMITTED',
        isError: false,
        label: 'Cancelado en PS (Sin pedido activo en Magic)',
        detail: 'El pedido fue cancelado en PowerSales (St 8) y no tiene pedido activo en cbpedvta.',
        ruleTitle: rule.ruleTitle,
        ruleDescription: rule.ruleDescription,
        needsAction: false,
      };
    }
    const magicEst = String(magicPedido.Estatus_Pedido || '').toUpperCase().trim();
    if (magicEst !== 'C') {
      return {
        code: isPendingInQueue ? 'PENDING_QUEUE' : 'ERROR_MISMATCH',
        isError: !isPendingInQueue,
        label: isPendingInQueue ? 'Cancelación en Cola' : 'Error: Sigue Activo en Magic (No Cancelado)',
        detail: `En PowerSales está CANCELADO (St 8), pero en Magic cbpedvta (#${magicPedido.No_Pedido}) sigue con Estatus_Pedido='${magicEst || 'P'}' en vez de 'C'.`,
        ruleTitle: rule.ruleTitle,
        ruleDescription: rule.ruleDescription,
        needsAction: true,
      };
    }
    return {
      code: 'SYNC_OK',
      isError: false,
      label: 'Correcto: Cancelado en Magic (Estatus = C)',
      detail: `En PS está Cancelado (St 8) y en Magic cbpedvta (#${magicPedido.No_Pedido}) está correctamente con Estatus_Pedido = 'C'.`,
      ruleTitle: rule.ruleTitle,
      ruleDescription: rule.ruleDescription,
      needsAction: false,
    };
  }

  // 4. Estatus donde SÍ O SÍ DEBE existir Pedido en cbpedvta (41, 38, 42, 43, 6, 7)
  if (!magicPedido) {
    if (isPendingInQueue) {
      return {
        code: 'PENDING_QUEUE',
        isError: false,
        label: 'Pedido en Cola (Esperando Pull)',
        detail: `Webhook #${masterWebhook.id} (St ${sId} ${sName}) esperando pull de Sucursal ${psOrder.branchId} para insertarse en cbpedvta.`,
        ruleTitle: rule.ruleTitle,
        ruleDescription: rule.ruleDescription,
        needsAction: true,
      };
    }

    const onlyInQuoteMsg = magicCotizacion
      ? `Se quedó sólo como Cotización en cbcot (#${magicCotizacion.No_Cotiza}), pero NO se creó el Pedido en cbpedvta.`
      : 'No existe ni en cbpedvta ni en cbcot.';

    const dbErrMsg = hasBranchDbError ? ` Error registrado: ${branchLog.error_msg}` : '';

    return {
      code: 'ERROR_MISSING',
      isError: true,
      label: 'Error: Falta Pedido en Magic (cbpedvta)',
      detail: `En PowerSales está en St ${sId} (${sName}), por lo que YA DEBE existir en cbpedvta. ${onlyInQuoteMsg}${dbErrMsg}`,
      ruleTitle: rule.ruleTitle,
      ruleDescription: rule.ruleDescription,
      needsAction: true,
    };
  }

  // El pedido SÍ existe en cbpedvta -> Verificar consistencia de estatus / errores
  const magicEst = String(magicPedido.Estatus_Pedido || '').toUpperCase().trim();
  const magicDist = magicPedido.Distribuido !== null && magicPedido.Distribuido !== undefined
    ? Number(magicPedido.Distribuido)
    : null;

  // Si en PS está activo (41, 38, 42, 7) pero en Magic está Cancelado ('C')
  // Nota: Solo es error si en el historial de PS no pasó por 8 (Cancelado), o si el último webhook falló
  if (hasBranchDbError) {
    return {
      code: 'ERROR_MISMATCH',
      isError: true,
      label: 'Error al Actualizar en Magic',
      detail: `Existe en cbpedvta (#${magicPedido.No_Pedido}), pero la última actualización (St ${sId}) falló con error DB: ${branchLog.error_msg}`,
      ruleTitle: rule.ruleTitle,
      ruleDescription: rule.ruleDescription,
      needsAction: true,
    };
  }

  // Si en PS ya está liberado (38 o 42) y en Magic sigue con Distribuido = 0
  if (rule.requireDistribuido1 && magicDist === 0) {
    return {
      code: isPendingInQueue ? 'PENDING_QUEUE' : 'ERROR_MISMATCH',
      isError: !isPendingInQueue,
      label: isPendingInQueue ? 'Liberación en Cola' : 'Error: No Liberado en Magic (Distribuido = 0)',
      detail: `En PowerSales ya está en St ${sId} (${sName}) que requiere Distribuido=1, pero en cbpedvta (#${magicPedido.No_Pedido}) sigue con Distribuido=0.`,
      ruleTitle: rule.ruleTitle,
      ruleDescription: rule.ruleDescription,
      needsAction: true,
    };
  }

  // Si en PS está Facturado (7 / INVOICED) y en Magic no tiene datos SAT (y no fue cancelado previamente)
  if (rule.requireSat && magicEst !== 'C' && !magicPedido.IDMetodoPagoSAT && !magicPedido.IDFormaPagoSAT && !magicPedido.IDUsoCFDISAT) {
    return {
      code: isPendingInQueue ? 'PENDING_QUEUE' : 'ERROR_MISMATCH',
      isError: !isPendingInQueue,
      label: isPendingInQueue ? 'Datos SAT en Cola' : 'Error: Faltan Datos SAT en cbpedvta',
      detail: `En PowerSales está Facturado (St 7 INVOICED), pero en cbpedvta (#${magicPedido.No_Pedido}) no se han grabado los campos SAT (IDMetodoPagoSAT).`,
      ruleTitle: rule.ruleTitle,
      ruleDescription: rule.ruleDescription,
      needsAction: true,
    };
  }

  return {
    code: 'SYNC_OK',
    isError: false,
    label: 'Correcto: Sincronizado en Magic',
    detail: `Pedido en cbpedvta #${magicPedido.No_Pedido} (Estatus Magic: ${magicEst || 'P'}, Distribuido: ${magicDist ?? '—'})${magicCotizacion ? ` · Cotización cbcot #${magicCotizacion.No_Cotiza}` : ''}.`,
    ruleTitle: rule.ruleTitle,
    ruleDescription: rule.ruleDescription,
    needsAction: false,
  };
}

/**
 * Construye un objeto pedido normalizado a partir de un payload de PowerSales
 * (ya sea proveniente de GET /orders o del último webhook recibido en webhook_logs).
 */
function normalizeOrderFromPayload(raw, { source, branchId, statusHistory = [], masterWebhook = null }) {
  const orderNumber = String(raw?.OrderNumber || raw?.order?.OrderNumber || '').trim();
  const details = Array.isArray(raw?.details)
    ? raw.details
    : (Array.isArray(raw?.OrdersDetails) ? raw.OrdersDetails : []);
  const promoOrder = raw?.details_promo?.[0]?.order || raw?.order || {};
  const warehouseName = promoOrder?.warehouse?.Name || details[0]?.Warehouse || '—';
  const currency = raw?.Currency || promoOrder?.Currency || 'MXN';
  const purchaseOrder = raw?.PurchaseOrderNumber || promoOrder?.PurchaseOrderNumber || '';

  return {
    psId: raw?.Id ?? promoOrder?.Id ?? null,
    orderNumber,
    source, // 'PS_API_GET' | 'PS_WEBHOOK' | 'BOTH'
    branchId,
    warehouseName,
    statusId: Number(raw?.StatusId ?? promoOrder?.StatusId ?? 0),
    statusName: raw?.StatusName || promoOrder?.StatusName || 'SIN DEFINIR',
    statusHistory,
    orderDate: raw?.OrderDate || promoOrder?.OrderDate || null,
    deliveryDate: raw?.DeliveryDate || promoOrder?.DeliveryDate || null,
    createdDate: raw?.CreatedDate || promoOrder?.CreatedDate || (masterWebhook?.fecha_recepcion ?? null),
    modifiedDate: raw?.ModifiedDate || promoOrder?.ModifiedDate || (masterWebhook?.fecha_recepcion ?? null),
    totalAmount: Number(raw?.TotalAmount ?? promoOrder?.TotalAmount ?? 0),
    totalQty: Number(raw?.TotalQty ?? promoOrder?.TotalQty ?? 0),
    paymentType: raw?.PaymentType || promoOrder?.PaymentType || '—',
    orderType: raw?.OrderType || promoOrder?.OrderType || '—',
    typeSend: raw?.TypeSend || promoOrder?.TypeSend || '—',
    currency,
    purchaseOrder,
    itemsCount: details.length,
    customer: {
      id: raw?.CustomerId?.Id ?? null,
      number: raw?.CustomerId?.CustomerNumber ?? '—',
      name: raw?.CustomerId?.Name ?? '—',
      tin: raw?.CustomerId?.TIN ?? '—',
    },
    rep: {
      id: raw?.RepId?.Id ?? null,
      number: raw?.RepId?.EmployeeNumber ?? '—',
      name: raw?.RepId?.UserName || raw?.RepId?.FirstName || '—',
    },
    route: {
      id: raw?.RouteId?.Id ?? null,
      name: raw?.RouteId?.Name ?? '—',
    },
  };
}

/**
 * GET /api/reconciliation/orders
 * Une los pedidos de GET /orders de PowerSales (borradores en PS) con todos los pedidos
 * recibidos de PowerSales vía webhook_logs (cotizaciones, pedidos, facturados, cancelados),
 * y verifica cada uno en tiempo real contra Magic (cbpedvta y cbcot).
 */
router.get('/orders', async (req, res) => {
  try {
    const maxPages = Math.max(1, Math.min(parseInt(req.query.max_pages) || 10, 30));

    // 1. Consultar GET /orders de PowerSales, estado de sucursales y logs de webhooks en paralelo
    const [psResult, branchStatuses, localLastWebhookId, [masterLogs]] = await Promise.all([
      fetchPowerSalesOrders(maxPages).catch(err => {
        console.warn('[RECONCILIATION] Error parcial en GET /orders de PowerSales:', err.message);
        return { orders: [], meta: { totalPsGet: 0, pagesFetched: 0, totalPages: 0, error: err.message } };
      }),
      getAllBranchStatuses().catch(() => []),
      getConfig('last_webhook_id', 0).catch(() => 0),
      localQuery(
        `SELECT id, entidad, clave_registro, datos, estado, error_msg, branch_id, fecha_recepcion
         FROM webhook_logs
         WHERE entidad = 'orders'
         ORDER BY id DESC
         LIMIT 3000`
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

    // 2. Agrupar historial de webhooks de PowerSales por OrderNumber
    // Guardamos el último payload completo, el mejor payload con renglones (para mostrar cliente/total cuando el último WH solo trae StatusId),
    // y la secuencia histórica de StatusId por los que pasó el pedido.
    const webhookOrdersMap = new Map();

    // Recorrer de más antiguo a más reciente para construir el historial cronológico limpio
    for (let i = masterLogs.length - 1; i >= 0; i--) {
      const row = masterLogs[i];
      let parsed = null;
      try {
        parsed = typeof row.datos === 'string' ? JSON.parse(row.datos) : row.datos;
      } catch (_) {}
      if (!parsed || typeof parsed !== 'object') continue;

      const orderNum = String(
        parsed?.OrderNumber ||
        parsed?.order?.OrderNumber ||
        row.clave_registro ||
        ''
      ).replace(/^"+|"+$/g, '').trim();

      if (!orderNum || orderNum === 'desconocido' || orderNum === 'OrderNumber') continue;

      const sId = Number(parsed?.StatusId ?? parsed?.order?.StatusId ?? 0);
      const sName = parsed?.StatusName ?? parsed?.order?.StatusName ?? null;
      const bId = row.branch_id ? Number(row.branch_id) : extractOrderBranchId(parsed, defaultBranchId);

      if (!webhookOrdersMap.has(orderNum)) {
        webhookOrdersMap.set(orderNum, {
          latestLogId: row.id,
          latestEstado: row.estado,
          latestErrorMsg: row.error_msg,
          latestFecha: row.fecha_recepcion,
          branchId: bId,
          lastPsStatusId: sId,
          lastPsStatusName: sName,
          statusHistory: sId ? [sId] : [],
          count: 1,
          latestPayload: parsed,
          richPayload: parsed, // payload que tenga CustomerId / TotalAmount / details
        });
      } else {
        const entry = webhookOrdersMap.get(orderNum);
        entry.latestLogId = row.id;
        entry.latestEstado = row.estado;
        entry.latestErrorMsg = row.error_msg;
        entry.latestFecha = row.fecha_recepcion;
        if (row.branch_id) entry.branchId = Number(row.branch_id);
        if (sId) {
          entry.lastPsStatusId = sId;
          entry.lastPsStatusName = sName;
          if (entry.statusHistory[entry.statusHistory.length - 1] !== sId) {
            entry.statusHistory.push(sId);
          }
        }
        entry.count += 1;
        entry.latestPayload = parsed;
        if (parsed.CustomerId || (Array.isArray(parsed.details) && parsed.details.length > 0) || Number(parsed.TotalAmount) > 0) {
          entry.richPayload = {
            ...entry.richPayload,
            ...parsed,
            CustomerId: parsed.CustomerId || entry.richPayload.CustomerId,
            RepId: parsed.RepId || entry.richPayload.RepId,
            RouteId: parsed.RouteId || entry.richPayload.RouteId,
            details: (Array.isArray(parsed.details) && parsed.details.length > 0) ? parsed.details : entry.richPayload.details,
            details_promo: (Array.isArray(parsed.details_promo) && parsed.details_promo.length > 0) ? parsed.details_promo : entry.richPayload.details_promo,
            TotalAmount: Number(parsed.TotalAmount) > 0 ? parsed.TotalAmount : entry.richPayload.TotalAmount,
            TotalQty: Number(parsed.TotalQty) > 0 ? parsed.TotalQty : entry.richPayload.TotalQty,
          };
        }
      }
    }

    // 3. Unificar pedidos de GET /orders (API en vivo) + pedidos de webhook_logs
    const unifiedOrdersMap = new Map();
    const ordersByBranch = new Map();

    // 3.A Agregar primero los de GET /orders
    for (const raw of psResult.orders) {
      const orderNum = String(raw?.OrderNumber || '').trim();
      if (!orderNum) continue;

      const whEntry = webhookOrdersMap.get(orderNum) || null;
      const branchId = extractOrderBranchId(raw, whEntry?.branchId || defaultBranchId);
      const hist = whEntry
        ? (whEntry.statusHistory.includes(Number(raw.StatusId)) ? whEntry.statusHistory : [...whEntry.statusHistory, Number(raw.StatusId)])
        : [Number(raw.StatusId)];

      // Si el pedido ya avanzó en webhooks a un estatus mayor que 1 (DRAFT), pero GET /orders lo devolvió,
      // preferimos el último estatus real si el webhook es más reciente
      const effectivePayload = (whEntry && Number(raw.StatusId) === 1 && whEntry.lastPsStatusId !== 1)
        ? { ...raw, StatusId: whEntry.lastPsStatusId, StatusName: whEntry.lastPsStatusName }
        : raw;

      const norm = normalizeOrderFromPayload(effectivePayload, {
        source: whEntry ? 'BOTH' : 'PS_API_GET',
        branchId,
        statusHistory: hist,
      });

      unifiedOrdersMap.set(orderNum, norm);
    }

    // 3.B Agregar todos los pedidos de webhook_logs que ya no aparecen en GET /orders (porque en PS ya tienen IsSync=1)
    for (const [orderNum, whEntry] of webhookOrdersMap.entries()) {
      if (unifiedOrdersMap.has(orderNum)) continue;

      const mergedPayload = {
        ...whEntry.richPayload,
        ...whEntry.latestPayload,
        StatusId: whEntry.lastPsStatusId,
        StatusName: whEntry.lastPsStatusName,
        CustomerId: whEntry.latestPayload.CustomerId || whEntry.richPayload.CustomerId,
        RepId: whEntry.latestPayload.RepId || whEntry.richPayload.RepId,
        RouteId: whEntry.latestPayload.RouteId || whEntry.richPayload.RouteId,
        details: (Array.isArray(whEntry.latestPayload.details) && whEntry.latestPayload.details.length > 0)
          ? whEntry.latestPayload.details
          : whEntry.richPayload.details,
        details_promo: (Array.isArray(whEntry.latestPayload.details_promo) && whEntry.latestPayload.details_promo.length > 0)
          ? whEntry.latestPayload.details_promo
          : whEntry.richPayload.details_promo,
        TotalAmount: Number(whEntry.latestPayload.TotalAmount) > 0
          ? whEntry.latestPayload.TotalAmount
          : whEntry.richPayload.TotalAmount,
        TotalQty: Number(whEntry.latestPayload.TotalQty) > 0
          ? whEntry.latestPayload.TotalQty
          : whEntry.richPayload.TotalQty,
      };

      const norm = normalizeOrderFromPayload(mergedPayload, {
        source: 'PS_WEBHOOK',
        branchId: whEntry.branchId || defaultBranchId,
        statusHistory: whEntry.statusHistory,
        masterWebhook: { fecha_recepcion: whEntry.latestFecha },
      });

      unifiedOrdersMap.set(orderNum, norm);
    }

    const normalizedOrders = Array.from(unifiedOrdersMap.values());
    for (const item of normalizedOrders) {
      if (!ordersByBranch.has(item.branchId)) {
        ordersByBranch.set(item.branchId, []);
      }
      ordersByBranch.get(item.branchId).push(item.orderNumber);
    }

    // 4. Consultar Magic ERP (cbpedvta y cbcot) por cada sucursal vía WebSocket (/branch-ws) o fallback local
    const magicByBranch = new Map();
    await Promise.all(
      Array.from(ordersByBranch.entries()).map(async ([branchId, orderNumbers]) => {
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

        // Fallback a BD ERP local SOLO si realmente contiene datos de esta sucursal (o si corre en modo sucursal)
        try {
          const localData = await buildOrdersMagicData({ orderNumbers });
          const isBranchMode = Boolean(process.env.CENTRAL_URL);
          const hasAnyMatch = Object.keys(localData.pedidos || {}).length > 0
            || Object.keys(localData.cotizaciones || {}).length > 0;
          if (localData.erpConnected && (isBranchMode || hasAnyMatch)) {
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

    // 5. Evaluar diagnóstico claro por pedido
    const summary = {
      totalOrders: normalizedOrders.length,
      syncOk: 0,           // Verde: Sincronizado donde corresponde (cbpedvta o cbcot)
      normalOmitted: 0,    // Gris/Neutro: Es normal que NO esté en Magic (Borrador St 1/3/35 o Cancelado sin pedido)
      pendingQueue: 0,     // Ámbar: En cola esperando pull de sucursal
      errorMissing: 0,     // ROJO: Debía existir en Magic por su estatus y NO existe
      errorMismatch: 0,    // ROJO: Existe en Magic pero su estatus/datos no coinciden o dio error DB
      totalErrors: 0,      // Suma de errorMissing + errorMismatch
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

      const whEntry = webhookOrdersMap.get(psOrder.orderNumber) || null;
      const masterWebhook = whEntry
        ? {
            id: whEntry.latestLogId,
            estado: whEntry.latestEstado,
            error_msg: whEntry.latestErrorMsg,
            branch_id: whEntry.branchId,
            fecha_recepcion: whEntry.latestFecha,
            lastPsStatusId: whEntry.lastPsStatusId,
            lastPsStatusName: whEntry.lastPsStatusName,
            count: whEntry.count,
          }
        : null;

      const branchInfo = branchMap.get(psOrder.branchId) || {
        branch_id: psOrder.branchId,
        last_poll_id: Number(localLastWebhookId || masterLogs[0]?.id || 0),
        online: branchSocket.isBranchOnline(psOrder.branchId) || bMagic.reachable,
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
      else if (diagnosis.code === 'NORMAL_OMITTED') summary.normalOmitted++;
      else if (diagnosis.code === 'PENDING_QUEUE') summary.pendingQueue++;
      else if (diagnosis.code === 'ERROR_MISSING') {
        summary.errorMissing++;
        summary.totalErrors++;
      } else if (diagnosis.code === 'ERROR_MISMATCH') {
        summary.errorMismatch++;
        summary.totalErrors++;
      }

      return {
        ...psOrder,
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

    // Ordenar poniendo primero cualquier error o pendiente, y luego por ID de PS / webhook más reciente
    rows.sort((a, b) => {
      const errA = a.diagnosis?.isError ? 1 : 0;
      const errB = b.diagnosis?.isError ? 1 : 0;
      if (errA !== errB) return errB - errA;
      const whA = a.webhook?.master?.id || 0;
      const whB = b.webhook?.master?.id || 0;
      if (whA !== whB) return whB - whA;
      return Number(b.psId || 0) - Number(a.psId || 0);
    });

    const branchesSummary = Array.from(ordersByBranch.keys()).map(bId => {
      const bInfo = branchMap.get(bId);
      const bMagic = magicByBranch.get(bId);
      const effectivePollId = Number(bInfo?.last_poll_id || localLastWebhookId || masterLogs[0]?.id || 0);
      return {
        branch_id: bId,
        hostname: bInfo?.hostname || `Sucursal ${bId}`,
        online: Boolean(bInfo?.online || bMagic?.reachable),
        wsOnline: branchSocket.isBranchOnline(bId),
        last_poll_id: effectivePollId,
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
 * Re-encola uno o varios pedidos hacia la sucursal tomando su payload de GET /orders
 * o de webhook_logs. Si el pedido ya está en StatusId 7 (INVOICED) pero falta crearse en cbpedvta,
 * primero encola un paso de creación (StatusId 42) con sus partidas y enseguida el StatusId 7.
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
    const [{ orders: psOrders }, branchStatuses, [masterLogs]] = await Promise.all([
      fetchPowerSalesOrders(maxPages).catch(() => ({ orders: [] })),
      getAllBranchStatuses().catch(() => []),
      localQuery(
        `SELECT id, clave_registro, datos, branch_id
         FROM webhook_logs
         WHERE entidad = 'orders'
         ORDER BY id ASC
         LIMIT 3000`
      ).catch(() => [[]]),
    ]);

    const defaultBranchId = branchStatuses[0]?.branch_id
      || (process.env.PS_BRANCH_ID ? parseInt(process.env.PS_BRANCH_ID) : 9);

    const payloadByOrder = new Map();
    for (const o of psOrders) {
      const num = String(o?.OrderNumber || '').trim();
      if (targetSet.has(num)) {
        payloadByOrder.set(num, { payload: o, branchId: extractOrderBranchId(o, defaultBranchId) });
      }
    }

    for (const row of masterLogs) {
      let parsed = null;
      try { parsed = typeof row.datos === 'string' ? JSON.parse(row.datos) : row.datos; } catch (_) {}
      if (!parsed) continue;
      const num = String(parsed?.OrderNumber || parsed?.order?.OrderNumber || row.clave_registro || '').replace(/^"+|"+$/g, '').trim();
      if (!targetSet.has(num)) continue;

      const prev = payloadByOrder.get(num)?.payload || {};
      const merged = {
        ...prev,
        ...parsed,
        CustomerId: parsed.CustomerId || prev.CustomerId,
        RepId: parsed.RepId || prev.RepId,
        RouteId: parsed.RouteId || prev.RouteId,
        details: (Array.isArray(parsed.details) && parsed.details.length > 0) ? parsed.details : prev.details,
        details_promo: (Array.isArray(parsed.details_promo) && parsed.details_promo.length > 0) ? parsed.details_promo : prev.details_promo,
        TotalAmount: Number(parsed.TotalAmount) > 0 ? parsed.TotalAmount : prev.TotalAmount,
        TotalQty: Number(parsed.TotalQty) > 0 ? parsed.TotalQty : prev.TotalQty,
      };
      payloadByOrder.set(num, {
        payload: merged,
        branchId: row.branch_id ? Number(row.branch_id) : extractOrderBranchId(merged, defaultBranchId),
      });
    }

    if (payloadByOrder.size === 0) {
      return res.status(404).json({ ok: false, error: 'No se encontró payload para los pedidos seleccionados' });
    }

    const enqueued = [];
    const branchesToTrigger = new Set();

    for (const [orderNum, { payload: orderData, branchId }] of payloadByOrder.entries()) {
      const sId = Number(orderData.StatusId);

      // Si el pedido ya está en StatusId 7 (INVOICED) pero faltaba crearse en cbpedvta,
      // primero encolamos un StatusId 42 para que handleOrderInsert cree el registro en cbpedvta y luego el StatusId 7
      if (sId === 7) {
        await saveWebhookLog(
          'orders',
          orderNum,
          { ...orderData, StatusId: 42, StatusName: 'PAYMENT_PENDING' },
          1,
          `[RE-SYNC MANUAL MAESTRO] Paso 1/2: Creación de pedido en cbpedvta (St 42)`,
          branchId
        );
      }

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
