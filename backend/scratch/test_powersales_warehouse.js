'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const ps = require('../src/powersales');

async function testWarehouse(warehouseId) {
  const payload = {
    data: [
      {
        BranchId: 9,
        ProductId: "10295QO120",
        WarehouseId: String(warehouseId),
        InventoryAvailable: 9999,
        InventoryTransitIn: 0,
        InventoryTransitOut: 0,
        InventoryNotAvailable: 0
      }
    ]
  };

  console.log(`\n--------------------------------------------------`);
  console.log(`Probando envio a PowerSales con WarehouseId = "${warehouseId}"`);

  try {
    const res = await ps.post('/warehouseinventory', payload);
    console.log(`Response Status: ${res.status} ${res.statusText}`);
    console.log(`Response Data:`, JSON.stringify(res.data));
  } catch (err) {
    console.error(`Error:`, err.message);
  }
}

async function run() {
  await testWarehouse("10");
  await testWarehouse("AIESA");
}

run().then(() => process.exit(0));
