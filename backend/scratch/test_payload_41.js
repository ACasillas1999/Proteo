require('dotenv').config();
const { handleOrderInsert } = require('../src/webhookHandlers');
const { query } = require('../src/db');

async function runTest() {
  try {
    const payload = {
      "OrderNumber": "VIC00000129W",
      "StatusId": 41,
      "StatusName": "ORDER_CREATED"
    };

    console.log('\n--- ANTES DEL PROCESAMIENTO ---');
    const [before] = await query("SELECT No_Pedido, Distribuido, IDPs FROM cbpedvta WHERE IDPs = 'VIC00000129W'");
    console.log(before);

    console.log('\n--- EJECUTANDO handleOrderInsert PARA STATUS 41 ---');
    await handleOrderInsert(payload);

    console.log('\n--- DESPUÉS DEL PROCESAMIENTO ---');
    const [after] = await query("SELECT No_Pedido, Distribuido, IDPs FROM cbpedvta WHERE IDPs = 'VIC00000129W'");
    console.log(after);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}

runTest();
