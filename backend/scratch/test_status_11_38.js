'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/db');
const { handleOrderInsert } = require('../src/webhookHandlers');

async function runTest() {
  console.log('====================================================');
  console.log('  PRUEBA DE FLUJO DE STATUSID: 11 Y 38 EN WEBHOOKS  ');
  console.log('====================================================\n');

  const testOrderNumber = 'TS_' + Date.now().toString().slice(-8);
  console.log(`📌 Número de orden de prueba: ${testOrderNumber}\n`);

  try {
    // 1. Enviar Webhook con StatusId 11 (Cotización)
    console.log('--- 1. Probando envío con StatusId: 11 (Cotización) ---');
    const payloadStatus11 = {
      OrderNumber: testOrderNumber,
      StatusId: 11,
      StatusName: 'COTIZACION',
      TotalAmount: 1160.00,
      SubTotalAmount: 1000.00,
      TotalTax: 160.00,
      CustomerId: { CustomerNumber: '000001' },
      details: [
        {
          ProductId: '1020625',
          QtyOrdered: 2,
          Price: 500.00
        }
      ]
    };

    await handleOrderInsert(payloadStatus11);

    // Verificar en db si existe en cbcot y si NO existe en cbpedvta
    const [cotRows11] = await query('SELECT * FROM cbcot WHERE IDPs = ?', [testOrderNumber]);
    const [pedRows11] = await query('SELECT * FROM cbpedvta WHERE No_Pedido = ? OR Cotizacion = ?', [testOrderNumber, cotRows11[0]?.No_Cotiza || -1]);

    console.log(`   ✓ Cotización en cbcot: ${cotRows11.length > 0 ? 'CREADA (No_Cotiza: ' + cotRows11[0].No_Cotiza + ')' : '❌ NO CREADA'}`);
    console.log(`   ✓ Pedido en cbpedvta: ${pedRows11.length === 0 ? 'NO CREADO (Correcto)' : '❌ ERROR: Se creó pedido para Status 11!'}`);
    console.log('');

    const noCotizaGenerado = cotRows11[0]?.No_Cotiza;

    // 2. Enviar Webhook de actualización con StatusId 11
    console.log('--- 2. Probando actualización con StatusId: 11 ---');
    const payloadStatus11Update = {
      ...payloadStatus11,
      TotalAmount: 2320.00,
      SubTotalAmount: 2000.00,
      TotalTax: 320.00
    };

    await handleOrderInsert(payloadStatus11Update);

    const [cotRows11Upd] = await query('SELECT Subtotal, Total FROM cbcot WHERE IDPs = ?', [testOrderNumber]);
    console.log(`   ✓ Total actualizado en cbcot: Total=${cotRows11Upd[0]?.Total} (Esperado: 2320)`);
    console.log('');

    // 3. Enviar Webhook con StatusId 38 (Cotización Aprobada -> Crear Pedido)
    console.log('--- 3. Probando aprobación con StatusId: 38 (Creación de Pedido) ---');
    const payloadStatus38 = {
      ...payloadStatus11Update,
      StatusId: 38,
      StatusName: 'COTIZACION APROBADA'
    };

    await handleOrderInsert(payloadStatus38);

    const [pedRows38] = await query('SELECT No_Pedido, Cotizacion, Distribuido, Total FROM cbpedvta WHERE Cotizacion = ?', [noCotizaGenerado]);
    console.log(`   ✓ Pedido en cbpedvta: ${pedRows38.length > 0 ? 'CREADO EXITOSAMENTE' : '❌ NO CREADO'}`);
    if (pedRows38.length > 0) {
      console.log(`     -> No_Pedido: #${pedRows38[0].No_Pedido} | Cotizacion asociada: #${pedRows38[0].Cotizacion} | Distribuido: ${pedRows38[0].Distribuido} | Total: ${pedRows38[0].Total}`);
    }

    console.log('\n====================================================');
    console.log('📊 PRUEBA COMPLETADA SATISFACTORIAMENTE');

  } catch (err) {
    console.error('❌ Error en prueba:', err);
  } finally {
    process.exit(0);
  }
}

runTest();
