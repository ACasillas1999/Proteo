'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const ps = require('../src/powersales');

async function testExactFields() {
  console.log('=== BUSCANDO EL CAMPO EXACTO QUE ACTUALIZA EL REGISTRO 92258 EN POWERSALES ===\n');

  const fieldCombinations = [
    { name: '1. InventoryAvailable string "950.00"', fields: { Id: 92258, ProductId: 98680, BranchId: 9, WarehouseId: 1, InventoryAvailable: "950.00" } },
    { name: '2. Inventory string "950.00"', fields: { Id: 92258, ProductId: 98680, BranchId: 9, WarehouseId: 1, Inventory: "950.00" } },
    { name: '3. Qty number 950', fields: { Id: 92258, ProductId: 98680, BranchId: 9, WarehouseId: 1, Qty: 950 } },
    { name: '4. Stock number 950', fields: { Id: 92258, ProductId: 98680, BranchId: 9, WarehouseId: 1, Stock: 950 } },
    { name: '5. Available number 950', fields: { Id: 92258, ProductId: 98680, BranchId: 9, WarehouseId: 1, Available: 950 } },
    { name: '6. Sin Id, pero con SKU "10295QO120" y WarehouseId 1', fields: { ProductId: "10295QO120", BranchId: 9, WarehouseId: 1, InventoryAvailable: 950 } },
    { name: '7. Sin Id, con SKU "10295QO120", WarehouseId "1", InventoryAvailable "950.00"', fields: { ProductId: "10295QO120", BranchId: "9", WarehouseId: "1", InventoryAvailable: "950.00" } },
    { name: '8. Con ProductCode "10295QO120"', fields: { ProductCode: "10295QO120", BranchId: 9, WarehouseId: 1, InventoryAvailable: 950 } },
  ];

  for (const c of fieldCombinations) {
    console.log(`\n--------------------------------------------------`);
    console.log(`PROBANDO: ${c.name}`);
    console.log('Payload item:', JSON.stringify(c.fields));

    try {
      const res = await ps.post('/warehouseinventory', { data: [c.fields] });
      console.log('Respuesta POST:', res.status, JSON.stringify(res.data));

      const check = await ps.get('/warehouseinventory', { params: { branch_id: 9, product_id: 98680 } });
      const rec = check.data.data?.find(r => r.Id === 92258 || r.WarehouseId == 1);
      console.log('Estado registro 92258 en PowerSales:', JSON.stringify(rec));

      if (rec && parseFloat(rec.InventoryAvailable) !== 1220) {
        console.log(`\n🎉🎉🎉 ¡¡¡ENCONTRADO EL CAMPO CORRECTO EN ${c.name}!!! ¡Cambió a ${rec.InventoryAvailable}! 🎉🎉🎉`);
        break;
      }
    } catch (err) {
      console.error('Error en prueba:', err.message);
    }
  }

  process.exit(0);
}

testExactFields();
