'use strict';
const { query } = require('../db');
const ps = require('../powersales');

async function sync(cambio) {
  const { clave_registro, campos_modificados } = cambio;
  const status = campos_modificados; // 'FULLY_PICKED' o 'PARTIALLY_PICKED'
  
  if (!status) {
    console.log(`[SYNC surtidopedido] Sin estatus en campos_modificados para Folio: ${clave_registro}`);
    return null;
  }

  // 1. Buscar el ID de PowerSales (IDPs) en cbpedvta correspondiente a este Folio
  const [orderRows] = await query(
    "SELECT IDPs FROM cbpedvta WHERE No_Pedido = ? LIMIT 1",
    [clave_registro]
  );

  if (orderRows.length === 0) {
    throw new Error(`Pedido local con Folio '${clave_registro}' no encontrado en cbpedvta.`);
  }

  const orderPsId = orderRows[0].IDPs;
  if (!orderPsId) {
    throw new Error(`El pedido local '${clave_registro}' no tiene IDPs (no ha sido enlazado a PowerSales).`);
  }

  // 2. Enviar la actualización de estatus a PowerSales
  const payload = {
    Id: orderPsId,
    PickingStatus: status
  };

  console.log(`[SYNC surtidopedido] Enviando estatus '${status}' para Pedido PS ID: ${orderPsId} (Folio ERP: ${clave_registro})`);
  
  // PowerSales: POST /orders con el payload de actualización de estatus de surtido
  await ps.post('/orders', { data: [payload] });

  return payload;
}

module.exports = { sync };
