'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const ps = require('../src/powersales');

async function runVariations() {
  console.log('=== INVESTIGANDO CÓMO POWERSALES ASOCIA EL INVENTARIO A LA BODEGA AIESA (Id: 92258) ===\n');

  // Variación 1: enviando warehouse_id, WarehouseId, warehouse, etc.
  const tests = [
    { name: 'Test 1: WarehouseId = 1 (number)', payload: { BranchId: 9, ProductId: 98680, WarehouseId: 1, InventoryAvailable: 950 } },
    { name: 'Test 2: WarehouseId = "1" (string)', payload: { BranchId: 9, ProductId: 98680, WarehouseId: "1", InventoryAvailable: 950 } },
    { name: 'Test 3: WarehouseId = "AIESA"', payload: { BranchId: 9, ProductId: 98680, WarehouseId: "AIESA", InventoryAvailable: 950 } },
    { name: 'Test 4: con Id de inventario = 92258 y WarehouseId = 1', payload: { Id: 92258, BranchId: 9, ProductId: 98680, WarehouseId: 1, InventoryAvailable: 950 } },
    { name: 'Test 5: con WarehouseInventoryId = 92258 y WarehouseId = 1', payload: { WarehouseInventoryId: 92258, BranchId: 9, ProductId: 98680, WarehouseId: 1, InventoryAvailable: 950 } },
    { name: 'Test 6: con SKU = "10295QO120" y WarehouseId = 1', payload: { BranchId: 9, SKU: "10295QO120", WarehouseId: 1, InventoryAvailable: 950 } },
  ];

  for (const t of tests) {
    console.log(`\n--- PROBANDO: ${t.name} ---`);
    console.log('Payload:', JSON.stringify(t.payload));

    try {
      const postRes = await ps.post('/warehouseinventory', { data: [t.payload] });
      console.log('POST Status/Data:', postRes.status, JSON.stringify(postRes.data));

      const getRes = await ps.get('/warehouseinventory', { params: { branch_id: 9, product_id: 98680 } });
      const recordAiesa = getRes.data.data?.find(r => r.Id === 92258 || r.WarehouseId == 1);
      console.log('Estado actual de Bodega AIESA (WarehouseId: 1 / Id: 92258):', JSON.stringify(recordAiesa));

      if (recordAiesa && parseFloat(recordAiesa.InventoryAvailable) === 950) {
        console.log(`\n🎉🎉🎉 ¡ÉXITO TOTAL EN ${t.name}! ¡La bodega AIESA cambió a 950! 🎉🎉🎉`);
        break;
      }
    } catch (e) {
      console.error('Error en prueba:', e.message);
    }
  }

  process.exit(0);
}

runVariations();
