'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const ps = require('../src/powersales');

async function queryAllInv() {
  try {
    console.log('--- GET /warehouseinventory (sin filtros) ---');
    const res1 = await ps.get('/warehouseinventory', { params: { product_id: 98680 } });
    console.log('Filtro product_id=98680:', JSON.stringify(res1.data, null, 2));

    console.log('\n--- GET /warehouseinventory (product_id="10295QO120") ---');
    const res2 = await ps.get('/warehouseinventory', { params: { product_id: '10295QO120' } });
    console.log('Filtro product_id="10295QO120":', JSON.stringify(res2.data, null, 2));

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    process.exit(0);
  }
}

queryAllInv();
