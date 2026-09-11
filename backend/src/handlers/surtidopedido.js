'use strict';
const { query } = require('../db');
const ps = require('../powersales');
const { getFieldMapping, getConfig, localQuery } = require('../localdb');

async function sync(cambio) {
  const { clave_registro, campos_modificados } = cambio;
  const status = campos_modificados; // 'FULLY_PICKED' o 'PARTIALLY_PICKED'

  if (!status) {
    console.log(`[SYNC surtidopedido] Sin estatus en campos_modificados para Folio: ${clave_registro}`);
    return null;
  }

  // 1. Obtener la tabla de cabecera y el mapeo de campos dinámicos
  const cabTable = await getConfig('pedido_cabecera_table', 'cbpedvta');
  const fieldMap = await getFieldMapping('pedido_cabecera');

  // Buscar qué columnas del ERP están mapeadas para 'Id' y 'OrderNumber'
  const erpIdCol = fieldMap['Id'];
  const erpOrderNumCol = fieldMap['OrderNumber'];

  // 2. Buscar datos del pedido en la tabla de cabecera del ERP (cbpedvta)
  const [orderRows] = await query(
    `SELECT * FROM \`${cabTable}\` WHERE No_Pedido = ? OR IDPs = ? LIMIT 1`,
    [clave_registro, clave_registro]
  );

  let orderPsId = null;
  let orderNumberIpad = null;
  let erpNoPedido = clave_registro;
  let employeeId = 3; // fallback por defecto

  if (orderRows.length > 0) {
    const row = orderRows[0];
    if (row.No_Pedido) {
      erpNoPedido = row.No_Pedido;
    }
    if (erpIdCol && row[erpIdCol]) {
      orderPsId = row[erpIdCol];
    }
    if (erpOrderNumCol && row[erpOrderNumCol]) {
      orderNumberIpad = row[erpOrderNumCol];
    } else if (row.IDPs) {
      orderNumberIpad = row.IDPs;
    }
    if (row.Cve_Atendio) {
      const parsedEmp = parseInt(row.Cve_Atendio, 10);
      if (!isNaN(parsedEmp) && parsedEmp > 0) {
        employeeId = parsedEmp;
      }
    }
  }

  if (!orderNumberIpad) {
    orderNumberIpad = String(clave_registro);
  }

  // 3. Fallback a webhook_logs SOLO si orderPsId no se encontró en cbpedvta
  if (!orderPsId) {
    try {
      const [logRows] = await localQuery(
        "SELECT datos FROM webhook_logs WHERE entidad = 'orders' ORDER BY id DESC LIMIT 300"
      );
      for (const log of logRows) {
        const datosJson = typeof log.datos === 'string' ? JSON.parse(log.datos) : log.datos;
        if (!datosJson) continue;

        const orderId = datosJson.order ? datosJson.order.Id : datosJson.Id;
        const orderNum = datosJson.order ? datosJson.order.OrderNumber : datosJson.OrderNumber;
        const poNum = datosJson.order ? datosJson.order.PurchaseOrderNumber : datosJson.PurchaseOrderNumber;
        const repObj = datosJson.order ? datosJson.order.RepId : datosJson.RepId;

        const matchByNum = orderNumberIpad && orderNum && (String(orderNum).trim() === String(orderNumberIpad).trim());
        const matchByClave = (orderNum && String(orderNum).trim() === String(clave_registro).trim()) ||
          (poNum && String(poNum).trim() === String(clave_registro).trim());

        if (matchByNum || matchByClave) {
          if (orderId) orderPsId = orderId;
          if (repObj && repObj.Id) employeeId = Number(repObj.Id);
          if (orderPsId) break;
        }
      }
    } catch (err) {
      console.error(`[SYNC surtidopedido] Error al buscar en logs:`, err.message);
    }
  }

  if (!orderPsId) {
    // Si no se encontró un ID numérico de PS, usamos orderNumberIpad como fallback
    orderPsId = orderNumberIpad;
  }

  // 4. Determinar los identificadores numéricos de estatus para PowerSales
  let statusId = 44; // default / 'SIN DEFINIR'
  if (status === 'FULLY_PICKED') {
    statusId = 43;
  } else if (status === 'PARTIALLY_PICKED') {
    statusId = 6;
  }

  // 5. Obtener las partidas del pedido directamente desde dtpedvta
  const detTable = await getConfig('pedido_detalle_table', 'dtpedvta');
  const fieldMapDet = await getFieldMapping('pedido_detalle');

  const skuCol = fieldMapDet['ProductId'] || 'Cve_Articulo';
  const qtyCol = fieldMapDet['QtyOrdered'] || 'Cant_Pedida';
  const priceCol = fieldMapDet['Price'] || 'Costo_Unitario';

  const [itemRows] = await query(
    `SELECT * FROM \`${detTable}\` WHERE No_Pedido = ? OR No_Pedido = ?`,
    [erpNoPedido, clave_registro]
  );

  const ordersDetails = [];
  for (const row of itemRows) {
    const sku = String(row[skuCol] || '').trim();
    if (!sku) continue;

    const qtyOrdered = Number(row[qtyCol] || 0);
    const qtyDelivered = Number(row.Cant_Facturada || 0);

    // Si está FULLY_PICKED surtimos todo lo pedido. Si es parcial, lo que está facturado (o fallback a lo pedido si está vacío)
    let qtyPicked = status === 'FULLY_PICKED' ? qtyOrdered : qtyDelivered;
    if (qtyPicked === 0) {
      qtyPicked = qtyOrdered;
    }

    const price = Number(row[priceCol] || 0);
    const subTotal = qtyOrdered * price;
    const total = qtyOrdered * price;

    ordersDetails.push({
      Id: null,
      ProductId: sku,
      ProductCode: sku,
      QtyOrdered: qtyOrdered.toFixed(2),
      QtyDelivered: qtyDelivered.toFixed(2),
      QtyPicked: qtyPicked.toFixed(2),
      Price: price.toFixed(2),
      SubTotalAmount: subTotal.toFixed(2),
      TotalAmount: total.toFixed(2),
      UniqueId: `UUID-${orderPsId}-${sku}`,
      WarehouseId: "1"
    });
  }

  const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const payload = {
    Id: Number(orderPsId) || orderPsId,
    StatusId: statusId,
    StatusName: status,
    OrderNumberIPAD: orderNumberIpad,
    IDPedidoEnc: Number(orderPsId) || orderPsId,
    Employee: Number(employeeId),
    ExternalReference: orderNumberIpad,
    ModifiedDate: nowStr,
    OrdersDetails: ordersDetails
  };

  console.log(`[SYNC surtidopedido] Enviando estatus '${status}' (StatusId: ${statusId}) con ${ordersDetails.length} artículos para Pedido PS ID: ${orderPsId} (Folio ERP: ${clave_registro}, OrderNumber: ${orderNumberIpad})`);

  // PowerSales: POST /orders con el payload de actualización de estatus de surtido
  const response = await ps.post('/orders', { data: payload });

  if (response && response.data) {
    const resData = response.data;
    if (resData.error === 1 || resData.ok === 0 || (Array.isArray(resData.noInsert) && resData.noInsert.length > 0)) {
      throw new Error(`Rechazado por PowerSales (error interno): ${JSON.stringify(resData)}`);
    }
  }

  return payload;
}

module.exports = { sync };
