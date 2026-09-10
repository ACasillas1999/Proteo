'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const ps = require('../src/powersales');

async function testGet() {
  try {
    console.log('--- GET /warehouseinventory (branch_id=9, warehouse_id=1) ---');
    const res = await ps.get('/warehouseinventory', { params: { branch_id: 9, warehouse_id: 1, product_id: '10295QO120' } });
    console.log('Respuesta GET:', JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.error('Error GET:', e.message);
  } finally {
    process.exit(0);
  }
}

testGet();
