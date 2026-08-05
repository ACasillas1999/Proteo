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
  
  // Buscar qué columna del ERP está mapeada para el ID interno de PowerSales del Pedido ('Id')
  const erpIdCol = fieldMap['Id'];
  if (!erpIdCol) {
    console.log(`[SYNC surtidopedido] Omitiendo envío para Folio: ${clave_registro}. El campo 'Id' del Pedido no está mapeado en la interfaz de Mapeo.`);
    return null;
  }

  // 2. Buscar el ID de PowerSales en la columna mapeada del ERP correspondiente a este Folio
  // La columna de relación local (Folio) se busca en No_Pedido
  const [orderRows] = await query(
    `SELECT \`${erpIdCol}\` AS orderPsId FROM \`${cabTable}\` WHERE No_Pedido = ? LIMIT 1`,
    [clave_registro]
  );

  if (orderRows.length === 0) {
    throw new Error(`Pedido local con Folio '${clave_registro}' no encontrado en tabla '${cabTable}'.`);
  }

  const orderPsId = orderRows[0].orderPsId;
  if (!orderPsId) {
    throw new Error(`El pedido local '${clave_registro}' en tabla '${cabTable}' no tiene un valor en la columna mapeada '${erpIdCol}'.`);
  }

  // 3. Determinar los identificadores numéricos de estatus para PowerSales
  let statusId = 44; // default / 'SIN DEFINIR'
  if (status === 'FULLY_PICKED') {
    statusId = 43;
  } else if (status === 'PARTIALLY_PICKED') {
    statusId = 6;
  }

  // 3.5 Intentar recuperar el OrderNumber original, el ID de Vendedor y las partidas originales de PowerSales
  let orderNumberIpad = String(clave_registro); // fallback: folio local
  let employeeId = 3; // fallback por defecto
  let originalDetails = [];
  try {
    const [logRows] = await localQuery(
      "SELECT datos FROM webhook_logs WHERE entidad = 'orders' ORDER BY id DESC LIMIT 100"
    );
    for (const log of logRows) {
      const datosJson = typeof log.datos === 'string' ? JSON.parse(log.datos) : log.datos;
      if (!datosJson) continue;

      // Intentar extraer del objeto anidado 'order' o de la raíz del JSON
      const orderId = datosJson.order ? datosJson.order.Id : datosJson.Id;
      const orderNum = datosJson.order ? datosJson.order.OrderNumber : datosJson.OrderNumber;
      const repObj = datosJson.order ? datosJson.order.RepId : datosJson.RepId;
      const details = datosJson.order ? datosJson.order.details : datosJson.details;

      if (orderId && (Number(orderId) === Number(orderPsId) || String(orderId) === String(orderPsId))) {
        if (orderNum) {
          orderNumberIpad = orderNum;
        }
        if (repObj && repObj.Id) {
          employeeId = Number(repObj.Id);
        }
        if (Array.isArray(details)) {
          originalDetails = details;
        }
        break;
      }
    }
  } catch (err) {
    console.error(`[SYNC surtidopedido] Error al buscar en logs:`, err.message);
  }

  // 4. Obtener las partidas del pedido desde la tabla de detalles del ERP (dtpedvta)
  const detTable = await getConfig('pedido_detalle_table', 'dtpedvta');
  const fieldMapDet = await getFieldMapping('pedido_detalle');

  const skuCol = fieldMapDet['ProductId'] || 'Cve_Articulo';
  const qtyCol = fieldMapDet['QtyOrdered'] || 'Cant_Pedida';
  const priceCol = fieldMapDet['Price'] || 'Costo_Unitario';

  const [itemRows] = await query(
    `SELECT * FROM \`${detTable}\` WHERE No_Pedido = ?`,
    [clave_registro]
  );

  const ordersDetails = [];
  for (const row of itemRows) {
    const sku = row[skuCol];
    if (!sku) continue;

    // Buscar la partida correspondiente en el webhook original para preservar IDs
    const origItem = originalDetails.find(d => 
      String(d.ProductId).trim() === String(sku).trim() || 
      String(d.ProductCode).trim() === String(sku).trim()
    );

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
      Id: origItem ? origItem.Id : null,
      ProductId: String(sku).trim(),
      ProductCode: String(sku).trim(),
      QtyOrdered: qtyOrdered.toFixed(2),
      QtyDelivered: qtyDelivered.toFixed(2),
      QtyPicked: qtyPicked.toFixed(2),
      Price: price.toFixed(2),
      SubTotalAmount: subTotal.toFixed(2),
      TotalAmount: total.toFixed(2),
      UniqueId: origItem ? origItem.UniqueId : `UUID-${orderPsId}-${sku}`,
      WarehouseId: origItem ? String(origItem.WarehouseId) : "1"
    });
  }

  const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const payload = {
    Id: orderPsId,
    StatusId: statusId,
    StatusName: status,
    OrderNumberIPAD: orderNumberIpad,
    IDPedidoEnc: orderPsId,
    Employee: employeeId,
    ExternalReference: orderNumberIpad,
    ModifiedDate: nowStr,
    OrdersDetails: ordersDetails
  };

  console.log(`[SYNC surtidopedido] Enviando estatus '${status}' (StatusId: ${statusId}) con ${ordersDetails.length} artículos para Pedido PS ID: ${orderPsId} (Folio ERP: ${clave_registro})`);
  
  // PowerSales: POST /orders con el payload de actualización de estatus de surtido
  // Nota: El API espera 'data' como un objeto único, no como un arreglo.
  await ps.post('/orders', { data: payload });

  return payload;
}

module.exports = { sync };
