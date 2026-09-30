'use strict';
require('dotenv').config();
const { handleOrderInsert } = require('./src/webhookHandlers');
const { query } = require('./src/db');

async function runComprehensiveTest() {
  console.log('====================================================');
  console.log(' PRUEBA FINAL DE VERIFICACIÓN DE MONEDA Y TIPO CAMBIO');
  console.log('====================================================');

  const cotizacionUSD = {
    Id: 999801,
    OrderNumber: 'TEST-COT-USD-01',
    StatusId: 11,
    StatusName: 'QUOTE',
    Currency: 'USD|es-US',
    CurrencyRate: '19.50',
    TotalAmount: '1950.00',
    CustomerId: { CustomerNumber: '15' },
    details: [{ ProductId: 'SKU-TEST-01', QtyOrdered: 1, Price: 1950 }]
  };

  const pedidoUSDNew = {
    Id: 999802,
    OrderNumber: 'TEST-PED-USD-01',
    StatusId: 38,
    StatusName: 'PROCESSED',
    Currency: 'USD|es-US',
    CurrencyRate: '19.50',
    TotalAmount: '1950.00',
    CustomerId: { CustomerNumber: '15' },
    details: [{ ProductId: 'SKU-TEST-01', QtyOrdered: 1, Price: 1950 }]
  };

  const pedidoUSDUpdate = {
    Id: 999802,
    OrderNumber: 'TEST-PED-USD-01',
    StatusId: 7,
    StatusName: 'INVOICED',
    Currency: 'USD|es-US',
    CurrencyRate: '20.10',
    TotalAmount: '2010.00',
    CustomerId: { CustomerNumber: '15' },
    invoice: { PaymentMethod: 'PUE', PaymentTypeId: '03', CfdiUse: 'G03' },
    details: [{ ProductId: 'SKU-TEST-01', QtyOrdered: 1, Price: 2010 }]
  };

  try {
    console.log('\n--- 1. Insertando Cotización en Dólares (USD|es-US, TC: 19.50) ---');
    await handleOrderInsert(cotizacionUSD);

    console.log('\n--- 2. Insertando Pedido Nuevo en Dólares (USD|es-US, TC: 19.50) ---');
    await handleOrderInsert(pedidoUSDNew);

    console.log('\n--- 3. Actualizando Pedido a INVOICED con TC: 20.10 ---');
    await handleOrderInsert(pedidoUSDUpdate);

    console.log('\n====================================================');
    console.log(' VERIFICACIÓN DE REGISTROS EN BASE DE DATOS MYSQL');
    console.log('====================================================');

    const [cotRows] = await query(
      'SELECT No_Cotiza, IDPs, Moneda, TC FROM cbcot WHERE No_Cotiza = 379742'
    );
    console.log('\nResultados en Cotización (cbcot):');
    console.table(cotRows);

    const [pedRows] = await query(
      'SELECT No_Pedido, IDPs, Moneda, Tipo_Cambio, IDMetodoPagoSAT, IDFormaPagoSAT, IDUsoCFDISAT FROM cbpedvta WHERE No_Pedido = 554842'
    );
    console.log('\nResultados en Pedido Cabecera (cbpedvta):');
    console.table(pedRows);

  } catch (err) {
    console.error('ERROR EN PRUEBA:', err.stack);
  }
}

runComprehensiveTest();
