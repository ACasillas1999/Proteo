'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const ps = require('../src/powersales');

async function testWithRealId() {
  const payload = {
    data: [
      {
        BranchId: 9,
        ProductId: 98680, // ID REAL del producto 10295QO120 en PowerSales (visto en la captura)
        WarehouseId: 1,   // Bodega AIESA
        InventoryAvailable: 950,
        InventoryTransitIn: 0,
        InventoryTransitOut: 0,
        InventoryNotAvailable: 0
      }
    ]
  };

  console.log('--- ENVIANDO POST /warehouseinventory con ProductId = 98680 (ID Real) ---');
  console.log('Payload:', JSON.stringify(payload, null, 2));

  try {
    const res = await ps.post('/warehouseinventory', payload);
    console.log('\nRespuesta POST:', JSON.stringify(res.data, null, 2));

    console.log('\n--- VERIFICANDO CON GET /warehouseinventory (product_id = 98680) ---');
    const getRes = await ps.get('/warehouseinventory', { params: { branch_id: 9, product_id: 98680 } });
    console.log('Respuesta GET:', JSON.stringify(getRes.data, null, 2));

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    process.exit(0);
  }
}

testWithRealId();
