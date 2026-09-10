'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const ps = require('../src/powersales');

async function testPostInt() {
  const payload = {
    data: [
      {
        BranchId: 9,
        ProductId: 10295, // Probando entero 10295
        WarehouseId: 1,
        InventoryAvailable: 950,
        InventoryTransitIn: 0,
        InventoryTransitOut: 0,
        InventoryNotAvailable: 0
      }
    ]
  };

  console.log('--- POST /warehouseinventory con ProductId = 10295 (entero) ---');
  try {
    const res = await ps.post('/warehouseinventory', payload);
    console.log('Respuesta POST:', JSON.stringify(res.data, null, 2));

    console.log('\n--- GET /warehouseinventory (branch_id=9, warehouse_id=1, product_id=10295) ---');
    const getRes = await ps.get('/warehouseinventory', { params: { branch_id: 9, warehouse_id: 1, product_id: 10295 } });
    console.log('Respuesta GET tras POST:', JSON.stringify(getRes.data, null, 2));

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    process.exit(0);
  }
}

testPostInt();
