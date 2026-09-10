'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const ps = require('../src/powersales');

async function testInventoryParams() {
  console.log('=== TEST DE PARAMETROS COMPLETO PARA POWERSALES INVENTORY ===\n');

  const payloads = [
    {
      label: 'Params con WarehouseNumber y BranchNumber',
      body: {
        data: [{
          BranchNumber: "9",
          WarehouseNumber: "1",
          SKU: "10295QO120",
          InventoryAvailable: 950
        }]
      }
    },
    {
      label: 'Params con ProductId=98680, WarehouseId=1, BranchId=9 y CreatedBy=1',
      body: {
        data: [{
          Id: 92258,
          ProductId: 98680,
          WarehouseId: 1,
          BranchId: 9,
          InventoryAvailable: 950,
          CreatedBy: 1,
          ModifiedBy: 1
        }]
      }
    },
    {
      label: 'Params con WarehouseId = "AIESA"',
      body: {
        data: [{
          ProductId: "10295QO120",
          BranchId: 9,
          WarehouseId: "AIESA",
          InventoryAvailable: 950
        }]
      }
    },
    {
      label: 'Params con WarehouseId = "1"',
      body: {
        data: [{
          ProductId: "10295QO120",
          BranchId: 9,
          WarehouseId: "1",
          InventoryAvailable: 950
        }]
      }
    }
  ];

  for (const p of payloads) {
    console.log(`\n--- Probando: ${p.label} ---`);
    try {
      const res = await ps.post('/warehouseinventory', p.body);
      console.log('Respuesta POST:', JSON.stringify(res.data));

      const getRes = await ps.get('/warehouseinventory', { params: { branch_id: 9, product_id: 98680 } });
      console.log('GET /warehouseinventory:', JSON.stringify(getRes.data.data));

    } catch (e) {
      console.error('Error:', e.message);
    }
  }

  process.exit(0);
}

testInventoryParams();
