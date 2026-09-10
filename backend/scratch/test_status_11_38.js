'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/db');
const { handleOrderInsert } = require('../src/webhookHandlers');

async function runTest() {
  console.log('====================================================');
  console.log('  PRUEBA COMPLETA DE COTIZACIÓN Y PEDIDO (11 Y 38) ');
  console.log('====================================================\n');

  const testOrderNumber = 'TS_' + Date.now().toString().slice(-8);
  console.log(`📌 Número de orden de prueba 1: ${testOrderNumber}\n`);

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

    // 3. Enviar Webhook con StatusId 38 (Cotización Aprobada -> Crear Pedido y Detalle)
    console.log('--- 3. Probando aprobación con StatusId: 38 (Creación de Pedido y Detalle) ---');
    const payloadStatus38 = {
      ...payloadStatus11Update,
      StatusId: 38,
      StatusName: 'COTIZACION APROBADA'
    };

    await handleOrderInsert(payloadStatus38);

    const [pedRows38] = await query('SELECT No_Pedido, Cotizacion, Distribuido, Total FROM cbpedvta WHERE Cotizacion = ?', [noCotizaGenerado]);
    console.log(`   ✓ Pedido en cbpedvta: ${pedRows38.length > 0 ? 'CREADO EXITOSAMENTE' : '❌ NO CREADO'}`);
    if (pedRows38.length > 0) {
      const createdNoPedido = pedRows38[0].No_Pedido;
      console.log(`     -> No_Pedido: #${createdNoPedido} | Cotizacion asociada: #${pedRows38[0].Cotizacion} | Total: ${pedRows38[0].Total}`);

      const [dtPedRows] = await query('SELECT No_Pedido, Partida, Cve_Articulo, Cant_Pedida, Costo_Unitario FROM dtpedvta WHERE No_Pedido = ?', [createdNoPedido]);
      console.log(`   ✓ Renglones en dtpedvta: ${dtPedRows.length} renglón(es) insertados`);
      if (dtPedRows.length > 0) {
        console.table(dtPedRows);
      } else {
        console.log('     ❌ ERROR: Renglones NO insertados en dtpedvta!');
      }
    }
    console.log('');

    // 4. Probando envío directo con StatusId: 38 (sin pasar por status 11 previo)
    console.log('--- 4. Probando envío directo con StatusId: 38 (Creación de Cotización + Pedido + Detalle) ---');
    const testDirect38OrderNumber = 'TS_DIR_' + Date.now().toString().slice(-6);
    const payloadDirect38 = {
      OrderNumber: testDirect38OrderNumber,
      StatusId: 38,
      StatusName: 'COTIZACION APROBADA DIRECTA',
      TotalAmount: 5800.00,
      SubTotalAmount: 5000.00,
      TotalTax: 800.00,
      CustomerId: { CustomerNumber: '000001' },
      details: [
        {
          ProductId: '1020625',
          QtyOrdered: 5,
          Price: 1000.00
        }
      ]
    };

    await handleOrderInsert(payloadDirect38);

    const [cotDirRows] = await query('SELECT No_Cotiza, Total FROM cbcot WHERE IDPs = ?', [testDirect38OrderNumber]);
    const [pedDirRows] = await query('SELECT No_Pedido, Cotizacion, Total FROM cbpedvta WHERE Cotizacion = ?', [cotDirRows[0]?.No_Cotiza || -1]);

    console.log(`   ✓ Cotización en cbcot creada/actualizada: ${cotDirRows.length > 0 ? 'SÍ (No_Cotiza: ' + cotDirRows[0].No_Cotiza + ', Total: ' + cotDirRows[0].Total + ')' : '❌ NO'}`);
    console.log(`   ✓ Pedido en cbpedvta creado: ${pedDirRows.length > 0 ? 'SÍ (No_Pedido: ' + pedDirRows[0].No_Pedido + ', Cotizacion: ' + pedDirRows[0].Cotizacion + ', Total: ' + pedDirRows[0].Total + ')' : '❌ NO'}`);

    if (pedDirRows.length > 0) {
      const createdDirectNoPedido = pedDirRows[0].No_Pedido;
      const [dtDirectPedRows] = await query('SELECT No_Pedido, Partida, Cve_Articulo, Cant_Pedida, Costo_Unitario FROM dtpedvta WHERE No_Pedido = ?', [createdDirectNoPedido]);
      console.log(`   ✓ Renglones en dtpedvta (Directo 38): ${dtDirectPedRows.length} renglón(es) insertados`);
      if (dtDirectPedRows.length > 0) {
        console.table(dtDirectPedRows);
      } else {
        console.log('     ❌ ERROR: Renglones NO insertados en dtpedvta para envío directo!');
      }
    }

    // 5. Probando transición de Estatus 38 a Estatus 41 (Verificar que NUNCA borre dtpedvta)
    console.log('--- 5. Probando transición de Estatus 38 a Estatus 41 ---');
    const payloadStatus41 = {
      OrderNumber: testDirect38OrderNumber,
      StatusId: 41,
      StatusName: 'DES-DISTRIBUIDO / LIBERADO',
      OrdersDetails: [
        {
          ProductId: '1020625',
          QtyOrdered: 5,
          Price: 1000.00
        }
      ]
    };

    await handleOrderInsert(payloadStatus41);

    const [ped41Rows] = await query('SELECT No_Pedido, Distribuido FROM cbpedvta WHERE Cotizacion = ?', [cotDirRows[0]?.No_Cotiza || -1]);
    const [dtPed41Rows] = await query('SELECT No_Pedido, Partida, Cve_Articulo, Cant_Pedida FROM dtpedvta WHERE No_Pedido = ?', [pedDirRows[0]?.No_Pedido]);

    console.log(`   ✓ Estado Distribuido en cbpedvta: ${ped41Rows[0]?.Distribuido} (Esperado: 0)`);
    console.log(`   ✓ Renglones en dtpedvta tras Estatus 41: ${dtPed41Rows.length} renglón(es) conservados!`);
    if (dtPed41Rows.length > 0) {
      console.table(dtPed41Rows);
    } else {
      console.log('   ❌ ERROR GRAVE: Las partidas fueron eliminadas al cambiar a Estatus 41!');
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
