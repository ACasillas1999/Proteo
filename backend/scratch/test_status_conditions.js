require('dotenv').config();
const { handleOrderInsert } = require('../src/webhookHandlers');
const { query } = require('../src/db');

async function testConditions() {
  try {
    console.log('--- TEST 1: Poner en 1 (StatusId 11) ---');
    await handleOrderInsert({ OrderNumber: "VIC00000129W", StatusId: 11 });
    let [res1] = await query("SELECT Distribuido FROM cbpedvta WHERE IDPs = 'VIC00000129W'");
    console.log('Resultado StatusId 11:', res1[0]);

    console.log('\n--- TEST 2: Enviar StatusId 38 (NO DEBE CAMBIAR A 0) ---');
    await handleOrderInsert({ OrderNumber: "VIC00000129W", StatusId: 38 });
    let [res2] = await query("SELECT Distribuido FROM cbpedvta WHERE IDPs = 'VIC00000129W'");
    console.log('Resultado StatusId 38:', res2[0]);

    console.log('\n--- TEST 3: Enviar StatusId 41 (DEBE CAMBIAR A 0) ---');
    await handleOrderInsert({ OrderNumber: "VIC00000129W", StatusId: 41 });
    let [res3] = await query("SELECT Distribuido FROM cbpedvta WHERE IDPs = 'VIC00000129W'");
    console.log('Resultado StatusId 41:', res3[0]);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}

testConditions();
