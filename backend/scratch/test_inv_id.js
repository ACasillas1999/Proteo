'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const ps = require('../src/powersales');

async function testWithInventoryId() {
  const payload = {
    data: [
      {
        Id: 92258,
        BranchId: 9,
        ProductId: 98680,
        WarehouseId: 1,
        InventoryAvailable: 950,
        InventoryTransitIn: 0,
        InventoryTransitOut: 0,
        InventoryNotAvailable: 0
      }
    ]
  };

  console.log('--- ENVIANDO POST CON ID DE INVENTARIO 92258 ---');
  try {
    const res = await ps.post('/warehouseinventory', payload);
    console.log('POST Response:', JSON.stringify(res.data, null, 2));

    const getRes = await ps.get('/warehouseinventory', { params: { branch_id: 9, product_id: 98680 } });
    console.log('GET Response:', JSON.stringify(getRes.data, null, 2));

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    process.exit(0);
  }
}

testWithInventoryId();
