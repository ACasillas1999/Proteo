'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const ps = require('../src/powersales');

async function testKeys() {
  console.log('=== TEST DE NOMBRES DE LLAVE DE ALMACEN EN POWERSALES ===\n');

  const keyVariations = [
    { name: 'WarehouseId', obj: { ProductId: 98680, BranchId: 9, WarehouseId: 1, InventoryAvailable: 888 } },
    { name: 'warehouse_id', obj: { product_id: 98680, branch_id: 9, warehouse_id: 1, inventory_available: 888 } },
    { name: 'WarehouseCode', obj: { ProductId: 98680, BranchId: 9, WarehouseCode: "1", InventoryAvailable: 888 } },
    { name: 'WarehouseNumber', obj: { ProductId: 98680, BranchId: 9, WarehouseNumber: "1", InventoryAvailable: 888 } },
    { name: 'IdWarehouse', obj: { ProductId: 98680, BranchId: 9, IdWarehouse: 1, InventoryAvailable: 888 } },
    { name: 'Warehouse', obj: { ProductId: 98680, BranchId: 9, Warehouse: 1, InventoryAvailable: 888 } },
    { name: 'warehouse', obj: { product_id: 98680, branch_id: 9, warehouse: 1, inventory_available: 888 } },
  ];

  for (const v of keyVariations) {
    console.log(`\n--- Probando campo: ${v.name} ---`);
    console.log('Payload:', JSON.stringify(v.obj));

    try {
      await ps.post('/warehouseinventory', { data: [v.obj] });
      
      const res = await ps.get('/warehouseinventory', { params: { product_id: 98680 } });
      const rec1 = res.data.data?.find(r => r.Id === 92258);
      const rec0 = res.data.data?.find(r => r.Id === 133667);

      console.log(`  -> Estado Id #92258 (AIESA, WhId=1): ${rec1?.InventoryAvailable} | UltMod: ${rec1?.ModifiedDate}`);
      console.log(`  -> Estado Id #133667 (WhId=0):      ${rec0?.InventoryAvailable} | UltMod: ${rec0?.ModifiedDate}`);

      if (rec1 && parseFloat(rec1.InventoryAvailable) === 888) {
        console.log(`\n🎉🎉🎉 ¡¡¡ENCONTRADO!!! La llave para actualizar AIESA es '${v.name}'! 🎉🎉🎉`);
        break;
      }
    } catch (e) {
      console.error('Error:', e.message);
    }
  }

  process.exit(0);
}

testKeys();
