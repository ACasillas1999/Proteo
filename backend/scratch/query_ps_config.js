'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const ps = require('../src/powersales');

async function checkConfig() {
  try {
    console.log('--- GET /branch ---');
    const bRes = await ps.get('/branch');
    console.log(JSON.stringify(bRes.data, null, 2));

    console.log('\n--- GET /configuration ---');
    const cRes = await ps.get('/configuration');
    console.log(JSON.stringify(cRes.data, null, 2));

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    process.exit(0);
  }
}

checkConfig();
