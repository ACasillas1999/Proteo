'use strict';
const { query } = require('../db');
const ps = require('../powersales');
const { getFieldMapping, getConfig } = require('../localdb');

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

  const payload = {
    Id: orderPsId,
    StatusId: statusId,
    StatusName: status
  };

  console.log(`[SYNC surtidopedido] Enviando estatus '${status}' (StatusId: ${statusId}) para Pedido PS ID: ${orderPsId} (Folio ERP: ${clave_registro})`);
  
  // PowerSales: POST /orders con el payload de actualización de estatus de surtido
  await ps.post('/orders', { data: [payload] });

  return payload;
}

module.exports = { sync };
