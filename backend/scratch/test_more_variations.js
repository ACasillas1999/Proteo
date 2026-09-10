'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const ps = require('../src/powersales');

async function runMoreTests() {
  console.log('=== INVESTIGANDO NOMBRES DE CAMPOS / MÉTODOS HTTP PARA POWERSALES ===\n');

  const tests = [
    // Usando POST con snake_case
    { name: 'POST snake_case product_id / warehouse_id', method: 'POST', url: '/warehouseinventory', payload: { data: [{ branch_id: 9, product_id: 98680, warehouse_id: 1, inventory_available: 950 }] } },
    { name: 'POST snake_case con SKU y warehouse_id', method: 'POST', url: '/warehouseinventory', payload: { data: [{ branch_id: 9, product_id: '10295QO120', warehouse_id: 1, inventory_available: 950 }] } },
    
    // Usando PUT con CamelCase
    { name: 'PUT /warehouseinventory CamelCase', method: 'PUT', url: '/warehouseinventory', payload: { data: [{ BranchId: 9, ProductId: 98680, WarehouseId: 1, InventoryAvailable: 950 }] } },
    { name: 'PUT /warehouseinventory/92258', method: 'PUT', url: '/warehouseinventory/92258', payload: { BranchId: 9, ProductId: 98680, WarehouseId: 1, InventoryAvailable: 950 } },
    
    // Usando PUT o POST a /branches/product
    { name: 'POST /branchesproducts', method: 'POST', url: '/branchesproducts', payload: { data: [{ BranchId: 9, ProductId: 98680, Stock: 950 }] } },
    
    // Usando id (llave primaria de la fila de inventario 92258)
    { name: 'POST con id = 92258', method: 'POST', url: '/warehouseinventory', payload: { data: [{ id: 92258, BranchId: 9, ProductId: 98680, WarehouseId: 1, InventoryAvailable: 950 }] } },
  ];

  for (const t of tests) {
    console.log(`\n--- ${t.name} ---`);
    console.log(`Petición: ${t.method} ${t.url}`, JSON.stringify(t.payload));

    try {
      let res;
      if (t.method === 'POST') res = await ps.post(t.url, t.payload);
      else if (t.method === 'PUT') res = await ps.put(t.url, t.payload);

      console.log('Respuesta:', res.status, JSON.stringify(res.data));

      const getRes = await ps.get('/warehouseinventory', { params: { branch_id: 9, product_id: 98680 } });
      const recordAiesa = getRes.data.data?.find(r => r.Id === 92258 || r.WarehouseId == 1);
      console.log('Bodega AIESA (WarehouseId: 1 / Id: 92258):', JSON.stringify(recordAiesa));

      if (recordAiesa && parseFloat(recordAiesa.InventoryAvailable) === 950) {
        console.log(`\n🎉🎉🎉 ¡ÉXITO TOTAL EN ${t.name}! ¡Se logró actualizar a 950! 🎉🎉🎉`);
        break;
      }
    } catch (e) {
      console.log('Error o Status:', e.message);
    }
  }

  process.exit(0);
}

runMoreTests();
