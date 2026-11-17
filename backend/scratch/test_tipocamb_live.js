'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const tipocambHandler = require('../src/handlers/tipocamb');
const axios = require('axios');

(async () => {
  console.log('Probando tipocambHandler.sync para id=3129 (2026-11-17)...');
  const t0 = Date.now();
  try {
    const res = await tipocambHandler.sync({
      id: 3129,
      tabla: 'Tipocamb',
      clave_registro: '2026-11-17'
    });
    console.log(`✅ ÉXITO en ${Date.now() - t0}ms:`, res);
  } catch (err) {
    console.error(`❌ ERROR en ${Date.now() - t0}ms:`, err.message);
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Data:', err.response.data);
    }
  }

  console.log('\nConsultando http://192.168.60.219:3001/api/config ...');
  try {
    const cfgRes = await axios.get('http://192.168.60.219:3001/api/config');
    console.log('Config en worker 60.219:', cfgRes.data);
  } catch (e) {
    console.error('Error config:', e.message);
  }
  process.exit(0);
})();

