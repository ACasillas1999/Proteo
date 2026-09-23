'use strict';
const { query } = require('../db');
const ps        = require('../powersales');

/**
 * Handler para sincronizar Tipo de Cambio (Tipocamb) con PowerSales
 * Endpoint: POST /currencyexchange
 */
async function sync(cambio) {
  const { clave_registro } = cambio;

  if (!clave_registro) {
    throw new Error('[SYNC TIPOCAMB] clave_registro vacía');
  }

  // Buscar el registro en Tipocamb por fecha
  const [rows] = await query(
    `SELECT * FROM Tipocamb WHERE DATE_FORMAT(Fecha, '%Y-%m-%d') = ? OR Fecha = ? LIMIT 1`,
    [clave_registro, clave_registro]
  );

  let row = rows[0];
  if (!row) {
    // Fallback: si no se encuentra la fecha exacta, tomar el último registro registrado
    const [latest] = await query(`SELECT * FROM Tipocamb ORDER BY Fecha DESC LIMIT 1`);
    row = latest[0];
  }

  if (!row) {
    throw new Error(`[SYNC TIPOCAMB] No se encontró registro en Tipocamb para clave: ${clave_registro}`);
  }

  // Formatear Fecha como YYYY-MM-DD
  let dateStr;
  if (row.Fecha instanceof Date) {
    dateStr = row.Fecha.toISOString().split('T')[0];
  } else {
    dateStr = String(row.Fecha).split('T')[0].split(' ')[0];
  }

  // Rate: Preferir DOF, si no existe o es 0 usar Tipo_Cambio
  const numRate = parseFloat(row.DOF) > 0 ? parseFloat(row.DOF) : parseFloat(row.Tipo_Cambio || 0);

  if (!numRate || isNaN(numRate)) {
    throw new Error(`[SYNC TIPOCAMB] Valor de Tipo de Cambio / DOF inválido en BD: ${row.DOF} / ${row.Tipo_Cambio}`);
  }

  const payload = {
    Currency: "USD",
    Rate: numRate.toFixed(4),
    RateBuy: "0.0000",
    RateSell: "0.0000",
    Date: dateStr,
    CurrencyBase: "MXN",
    CreatedBy: 15
  };

  console.log(`[SYNC TIPOCAMB] Enviando tipo de cambio a PowerSales (${dateStr}):`, payload);

  const res = await ps.post('/currencyexchange', payload);

  console.log(`[SYNC TIPOCAMB] ✓ PowerSales respondió correctamente:`, res.data?.message || 'OK');

  return { payload, response: res.data };
}

module.exports = { sync };
