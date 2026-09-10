'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const ps = require('../src/powersales');

async function run() {
  try {
    console.log('\n--- GET /warehouseinventory (branch_id=9) ---');
    const invRes = await ps.get('/warehouseinventory', { params: { branch_id: 9, page: 1 } });
    console.log(JSON.stringify(invRes.data, null, 2));

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit(0);
  }
}

run();
