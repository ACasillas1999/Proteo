'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const ps = require('../src/powersales');

async function testInventoryIdKeys() {
  console.log('=== BUSCANDO CÓMO POWERSALES ACTUALIZA LA FILA 92258 ===\n');

  const tests = [
    { name: 'WarehouseInventoryId: 92258', payload: { WarehouseInventoryId: 92258, ProductId: 98680, BranchId: 9, WarehouseId: 1, InventoryAvailable: 950 } },
    { name: 'id: 92258 (minúscula)', payload: { id: 92258, ProductId: 98680, BranchId: 9, WarehouseId: 1, InventoryAvailable: 950 } },
    { name: 'Id: "92258" (string)', payload: { Id: "92258", ProductId: 98680, BranchId: 9, WarehouseId: 1, InventoryAvailable: 950 } },
    { name: 'WarehouseInventoryId: "92258"', payload: { WarehouseInventoryId: "92258", ProductId: 98680, BranchId: 9, WarehouseId: 1, InventoryAvailable: 950 } },
    { name: 'PUT /warehouseinventory (con Id: 92258)', method: 'PUT', payload: { data: [{ Id: 92258, ProductId: 98680, BranchId: 9, WarehouseId: 1, InventoryAvailable: 950 }] } },
    { name: 'POST /warehouseinventory/92258', method: 'POST', url: '/warehouseinventory/92258', payload: { InventoryAvailable: 950 } },
    { name: 'POST /warehouseinventory/update', method: 'POST', url: '/warehouseinventory/update', payload: { data: [{ Id: 92258, InventoryAvailable: 950 }] } }
  ];

  for (const t of tests) {
    console.log(`\n--- ${t.name} ---`);
    const url = t.url || '/warehouseinventory';
    const method = t.method || 'POST';
    const body = t.url ? t.payload : (t.payload.data ? t.payload : { data: [t.payload] });

    try {
      let res;
      if (method === 'POST') res = await ps.post(url, body);
      else if (method === 'PUT') res = await ps.put(url, body);

      console.log('Respuesta:', res.status, JSON.stringify(res.data));

      const check = await ps.get('/warehouseinventory', { params: { product_id: 98680 } });
      const rec1 = check.data.data?.find(r => r.Id === 92258);
      console.log('Estado actual de fila 92258 (AIESA):', JSON.stringify(rec1));

      if (rec1 && parseFloat(rec1.InventoryAvailable) !== 1220) {
        console.log(`\n🎉🎉🎉 ¡¡¡LOGRADO!!! ¡La fila 92258 cambió a ${rec1.InventoryAvailable}! 🎉🎉🎉`);
        break;
      }
    } catch (e) {
      console.log('Resultado/Error:', e.message);
    }
  }

  process.exit(0);
}

testInventoryIdKeys();
