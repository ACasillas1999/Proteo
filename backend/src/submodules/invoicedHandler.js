'use strict';
const { query } = require('../db');
const { getFieldMapping } = require('../localdb');

/**
 * Submódulo especial exclusivo para cuando el webhook llega en estatus INVOICED (o trae objeto invoice).
 * Escribe únicamente en 3 campos dentro de la tabla cbpedvta y no modifica nada más:
 * - IDMetodoPagoSAT:
 *     SI es CONTADO / PUE -> 'PUE'
 *     SI es CREDITO / PPD -> 'PPD'
 * - IDFormaPagoSAT:
 *     Toma PaymentTypeId de PowerSales / invoice (formateado a 2 dígitos)
 * - IDUsoCFDISAT:
 *     Toma CfdiUse de PowerSales / invoice (ej. 'G01', 'G03')
 */
async function handleInvoicedSubmodule(data, targetNoPedido, cabTable = 'cbpedvta', cabCols = []) {
  const statusNameVal = typeof data.StatusName === 'string' ? data.StatusName.toUpperCase().trim() : '';
  const statusIdNum = parseInt(data.StatusId);

  // Verificar si el pedido viene en estatus INVOICED o trae objeto invoice
  const isInvoiced = statusNameVal === 'INVOICED' || statusIdNum === 7 || data.invoice !== undefined;
  if (!isInvoiced) {
    return false;
  }

  console.log(`[SUBMÓDULO INVOICED] Estatus INVOICED detectado para No_Pedido: ${targetNoPedido}`);

  // 1. IDMetodoPagoSAT: SI es CONTADO / PUE -> PUE, Si es CREDITO / PPD -> PPD
  let rawPaymentVal = String(
    data.invoice?.PaymentMethod ||
    data.invoice?.paymentMethod ||
    data.invoice?.paymentmethod ||
    data.PaymentMethod ||
    data.paymentMethod ||
    data.paymentmethod ||
    data.invoice?.paymenttypeSAT ||
    data.invoice?.paymentTypeSAT ||
    data.invoice?.PaymentTypeSAT ||
    data.paymenttypeSAT ||
    data.paymentTypeSAT ||
    data.PaymentTypeSAT ||
    data.IDMetodoPagoSAT ||
    data.PaymentType ||
    data.Payment ||
    (data.CustomerId && data.CustomerId.IsCredit !== undefined ? (Number(data.CustomerId.IsCredit) === 1 ? 'CREDITO' : 'CONTADO') : '')
  ).trim().toUpperCase();

  let idMetodoPagoSAT = null;
  if (rawPaymentVal.includes('CRED') || rawPaymentVal === 'CR' || rawPaymentVal === 'PPD') {
    idMetodoPagoSAT = 'PPD';
  } else if (rawPaymentVal.includes('CONT') || rawPaymentVal === 'CO' || rawPaymentVal === 'PUE' || rawPaymentVal === '0') {
    idMetodoPagoSAT = 'PUE';
  } else if (rawPaymentVal) {
    idMetodoPagoSAT = rawPaymentVal === 'PPD' ? 'PPD' : 'PUE';
  }

  // 2. IDUsoCFDISAT: CfdiUse de PowerSales / invoice (ej. 'G01', 'G03')
  let idUsoCFDISAT = String(
    data.invoice?.CfdiUse ||
    data.invoice?.cfdiuse ||
    data.invoice?.Cfdiuse ||
    data.CfdiUse ||
    data.cfdiuse ||
    data.IDUsoCFDISAT ||
    ''
  ).trim() || null;

  // 3. IDFormaPagoSAT: PaymentTypeSAT (ej. '01', '03', '99')
  let rawPaymentTypeId =
    data.invoice?.payments?.[0]?.PaymentTypeSAT ??
    data.invoice?.payments?.[0]?.paymentTypeSAT ??
    data.invoice?.payments?.[0]?.paymenttypesat ??
    data.invoice?.PaymentTypeSAT ??
    data.invoice?.paymentTypeSAT ??
    data.invoice?.paymenttypesat ??
    data.PaymentTypeSAT ??
    data.paymentTypeSAT ??
    data.paymenttypesat ??
    data.IDFormaPagoSAT ??
    data.invoice?.payments?.[0]?.PaymentTypeId ??
    data.PaymentTypeId;

  let idFormaPagoSAT = null;
  if (rawPaymentTypeId !== undefined && rawPaymentTypeId !== null && rawPaymentTypeId !== '') {
    const parsedInt = parseInt(rawPaymentTypeId);
    if (!isNaN(parsedInt)) {
      idFormaPagoSAT = String(parsedInt).padStart(2, '0');
    } else {
      idFormaPagoSAT = String(rawPaymentTypeId).trim();
    }
  }

  // Regla especial para Cliente 999 (Nota de Venta): IDMetodoPagoSAT = 'PUE' e IDUsoCFDISAT = 'S01'
  const rawCustomerNumber = String(
    data.CustomerId?.CustomerNumber ||
    data.CustomerId?.Id ||
    data.CustomerNumber ||
    data.invoice?.CustomerId?.CustomerNumber ||
    ''
  ).trim();
  if (rawCustomerNumber === '999') {
    console.log(`[SUBMÓDULO INVOICED] Cliente 999 (Nota de Venta) detectado -> Forzando IDMetodoPagoSAT = 'PUE' e IDUsoCFDISAT = 'S01'`);
    idMetodoPagoSAT = 'PUE';
    idUsoCFDISAT = 'S01';
  }

  // Regla especial para Crédito (PPD): IDFormaPagoSAT siempre es '99' (Por definir)
  if (idMetodoPagoSAT === 'PPD') {
    console.log(`[SUBMÓDULO INVOICED] Crédito (PPD) detectado -> Forzando IDFormaPagoSAT = '99'`);
    idFormaPagoSAT = '99';
  }

  console.log(`[SUBMÓDULO INVOICED] Valores mapeados para No_Pedido ${targetNoPedido}:`, {
    IDMetodoPagoSAT: idMetodoPagoSAT,
    IDFormaPagoSAT: idFormaPagoSAT,
    IDUsoCFDISAT: idUsoCFDISAT
  });

  const fieldMapCab = await getFieldMapping('pedido_cabecera').catch(() => ({}));
  const targetMetodoCol = (fieldMapCab['IDMetodoPagoSAT'] !== undefined && fieldMapCab['IDMetodoPagoSAT'] !== '') ? fieldMapCab['IDMetodoPagoSAT'] : 'IDMetodoPagoSAT';
  const targetFormaCol  = (fieldMapCab['IDFormaPagoSAT']  !== undefined && fieldMapCab['IDFormaPagoSAT']  !== '') ? fieldMapCab['IDFormaPagoSAT']  : 'IDFormaPagoSAT';
  const targetUsoCol    = (fieldMapCab['IDUsoCFDISAT']    !== undefined && fieldMapCab['IDUsoCFDISAT']    !== '') ? fieldMapCab['IDUsoCFDISAT']    : 'IDUsoCFDISAT';
  const targetMonedaCol = (fieldMapCab['Currency'] !== undefined && fieldMapCab['Currency'] !== '') ? fieldMapCab['Currency'] : 'Moneda';
  const targetTcCol     = (fieldMapCab['CurrencyRate'] !== undefined && fieldMapCab['CurrencyRate'] !== '') ? fieldMapCab['CurrencyRate'] : 'Tipo_Cambio';

  const updates = [];
  const params = [];

  const realMetodoCol = cabCols.find(c => c.toLowerCase() === String(targetMetodoCol).toLowerCase());
  if (realMetodoCol && idMetodoPagoSAT) {
    updates.push(`\`${realMetodoCol}\` = ?`);
    params.push(idMetodoPagoSAT);
  }

  const realFormaCol = cabCols.find(c => c.toLowerCase() === String(targetFormaCol).toLowerCase());
  if (realFormaCol && idFormaPagoSAT) {
    updates.push(`\`${realFormaCol}\` = ?`);
    params.push(idFormaPagoSAT);
  }

  const realUsoCol = cabCols.find(c => c.toLowerCase() === String(targetUsoCol).toLowerCase());
  if (realUsoCol && idUsoCFDISAT) {
    updates.push(`\`${realUsoCol}\` = ?`);
    params.push(idUsoCFDISAT);
  }

  // Actualizar Moneda y Tipo_Cambio si vienen en el payload
  const rawCurrencyStr = String(
    data.Currency ?? data.currency ?? data.invoice?.Currency ?? data.invoice?.currency ?? data.details_promo?.[0]?.order?.Currency ?? data.details_promo?.[0]?.order?.currency ?? ''
  ).toUpperCase().trim();
  if (rawCurrencyStr) {
    const calcCurrency = (rawCurrencyStr.includes('USD') || rawCurrencyStr.includes('US') || rawCurrencyStr === '2') ? 2 : 1;
    const realMonedaCol = cabCols.find(c => c.toLowerCase() === String(targetMonedaCol).toLowerCase() || c.toLowerCase() === 'moneda');
    if (realMonedaCol) {
      updates.push(`\`${realMonedaCol}\` = ?`);
      params.push(calcCurrency);
    }
  }

  const rawRateVal = data.CurrencyRate ?? data.currencyRate ?? data.Currencyrate ?? data.ExchangeRate ?? data.exchangeRate ?? data.invoice?.CurrencyRate ?? data.invoice?.currencyRate ?? data.details_promo?.[0]?.order?.CurrencyRate ?? data.details_promo?.[0]?.order?.currencyRate;
  if (rawRateVal !== undefined && rawRateVal !== null && rawRateVal !== '') {
    const calcRate = Number(rawRateVal);
    if (!isNaN(calcRate)) {
      const realTcCol = cabCols.find(c => c.toLowerCase() === String(targetTcCol).toLowerCase() || c.toLowerCase() === 'tipo_cambio' || c.toLowerCase() === 'tipocambio' || c.toLowerCase() === 'tc');
      if (realTcCol) {
        updates.push(`\`${realTcCol}\` = ?`);
        params.push(calcRate);
      }
    }
  }

  if (updates.length > 0) {
    params.push(targetNoPedido);
    await query(`UPDATE \`${cabTable}\` SET ${updates.join(', ')} WHERE No_Pedido = ?`, params);
    console.log(`[SUBMÓDULO INVOICED] ✓ '${cabTable}' actualizado exitosamente con datos SAT para No_Pedido: ${targetNoPedido}`);
  } else {
    console.log(`[SUBMÓDULO INVOICED] No se encontraron columnas SAT elegibles en '${cabTable}' para actualizar.`);
  }

  return true;
}

module.exports = { handleInvoicedSubmodule };
