'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { handleOrderInsert } = require('../src/webhookHandlers');
const { query } = require('../src/db');

async function testRepeatStatus11() {
  const testOrderNo = 'TESTCOT999W';
  console.log('====================================================');
  console.log(`   PRUEBA DE COTIZACIÓN MODIFICADA (StatusId = 11)  `);
  console.log('====================================================\n');

  try {
    // Limpiar pruebas anteriores
    await query("DELETE FROM cbpedvta WHERE IDPs = ? OR No_OC = ?", [testOrderNo, testOrderNo]);
    await query("DELETE FROM cbcot WHERE IDPs = ? OR OC = ?", [testOrderNo, testOrderNo]);

    // 1. Envío Versión 1: Cotización inicial con 1 producto ($100)
    console.log('--- 1. PRIMER ENVÍO: Cotización inicial (1 producto, Total: $100) ---');
    const payloadV1 = {
      OrderNumber: testOrderNo,
      StatusId: 11,
      StatusName: "COTIZADO",
      TotalAmount: "100.00",
      SubTotalAmount: "86.21",
      CustomerId: { Id: 15, CustomerNumber: "15" },
      RouteId: { Name: "VICENTE" },
      details: [
        { ProductId: "00060THEB-3/16", QtyOrdered: "1", Price: "100.00", SubTotalAmount: "86.21", TotalAmount: "100.00" }
      ]
    };

    await handleOrderInsert(payloadV1);

    const [cabV1] = await query("SELECT No_Pedido, Total, Subtotal, Distribuido FROM cbpedvta WHERE IDPs = ? OR No_OC = ?", [testOrderNo, testOrderNo]);
    console.log('✓ Pedido V1 en cbpedvta:', cabV1[0]);

    const [detV1] = await query("SELECT No_Pedido, Partida, Cve_Art, Cant_Facturar FROM dtpedvta WHERE No_Pedido = ?", [cabV1[0].No_Pedido]);
    console.log('✓ Renglones V1 en dtpedvta:', detV1);

    const [cotV1] = await query("SELECT No_Cotiza, Total, Subtotal FROM cbcot WHERE IDPs = ? OR OC = ?", [testOrderNo, testOrderNo]);
    console.log('✓ Cotización V1 en cbcot:', cotV1[0]);

    // 2. Envío Versión 2: Vendedor modifica la cotización en PowerSales (2 productos, Total: $350)
    console.log('\n--- 2. SEGUNDO ENVÍO: Cotización modificada en PowerSales (2 productos, Total: $350) ---');
    const payloadV2 = {
      OrderNumber: testOrderNo,
      StatusId: 11,
      StatusName: "COTIZADO",
      TotalAmount: "350.00",
      SubTotalAmount: "301.72",
      CustomerId: { Id: 15, CustomerNumber: "15" },
      RouteId: { Name: "VICENTE" },
      details: [
        { ProductId: "00060THEB-3/16", QtyOrdered: "2", Price: "100.00", SubTotalAmount: "172.41", TotalAmount: "200.00" },
        { ProductId: "00060DK-100SS", QtyOrdered: "1", Price: "150.00", SubTotalAmount: "129.31", TotalAmount: "150.00" }
      ]
    };

    await handleOrderInsert(payloadV2);

    const [cabV2] = await query("SELECT No_Pedido, Total, Subtotal, Distribuido FROM cbpedvta WHERE No_Pedido = ?", [cabV1[0].No_Pedido]);
    console.log('🎉 Pedido V2 actualizado en cbpedvta:', cabV2[0]);

    const [detV2] = await query("SELECT No_Pedido, Partida, Cve_Art, Cant_Facturar FROM dtpedvta WHERE No_Pedido = ?", [cabV1[0].No_Pedido]);
    console.table(detV2);

    if (cotV1.length > 0) {
      const [cotV2] = await query("SELECT No_Cotiza, Total, Subtotal FROM cbcot WHERE No_Cotiza = ?", [cotV1[0].No_Cotiza]);
      console.log('🎉 Cotización V2 actualizada en cbcot:', cotV2[0]);

      const [cotDetV2] = await query("SELECT N_Cotizacion, Partida, Cve_Art, Cant_Facturar FROM dtcot WHERE N_Cotizacion = ?", [cotV1[0].No_Cotiza]);
      console.table(cotDetV2);
    }

    // 3. Limpieza final de prueba
    await query("DELETE FROM dtpedvta WHERE No_Pedido = ?", [cabV1[0].No_Pedido]);
    await query("DELETE FROM cbpedvta WHERE No_Pedido = ?", [cabV1[0].No_Pedido]);
    if (cotV1.length > 0) {
      await query("DELETE FROM dtcot WHERE N_Cotizacion = ?", [cotV1[0].No_Cotiza]);
      await query("DELETE FROM cbcot WHERE No_Cotiza = ?", [cotV1[0].No_Cotiza]);
    }
    console.log('\n✅ Prueba completada con éxito. Registros de prueba limpios.');

  } catch (err) {
    console.error('❌ Error en prueba:', err);
  } finally {
    process.exit(0);
  }
}

testRepeatStatus11();
