'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const ps = require('../src/powersales');

async function checkWarehouseSingular() {
  try {
    console.log('--- GET /warehouse ---');
    const res = await ps.get('/warehouse');
    console.log(JSON.stringify(res.data, null, 2));

    console.log('\n--- GET /branches ---');
    const bRes = await ps.get('/branches');
    console.log(JSON.stringify(bRes.data, null, 2));

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    process.exit(0);
  }
}

checkWarehouseSingular();
