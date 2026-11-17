'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query } = require('../src/db');
const { localQuery } = require('../src/localdb');
const axios = require('axios');

(async () => {
  try {
    const [counts] = await query('SELECT sincronizado, COUNT(*) as total, MIN(id) as min_id, MAX(id) as max_id FROM Cambios GROUP BY sincronizado');
    console.log('=== RESUMEN TABLA CAMBIOS ===');
    console.table(counts);

    const [oldestPending] = await query('SELECT * FROM Cambios WHERE sincronizado = 0 ORDER BY id ASC LIMIT 20');
    console.log('\n=== PRIMEROS 20 PENDIENTES EN COLA (ORDENADOS POR ID ASC, COMO LEE EL POLLER) ===');
    console.table(oldestPending);

    const [lastProcessed] = await query('SELECT * FROM Cambios WHERE sincronizado IN (1, 2) ORDER BY fecha_sync DESC LIMIT 10');
    console.log('\n=== ÚLTIMOS 10 PROCESADOS EN CAMBIOS ===');
    console.table(lastProcessed);

    const [branchStat] = await localQuery('SELECT * FROM branch_status');
    console.log('\n=== BRANCH STATUS EN LOCALDB ===');
    console.table(branchStat);

    for (const host of ['http://127.0.0.1:3001', 'http://192.168.60.219:3001', 'http://192.168.40.1:3001', 'https://endpoint-productivo.grupoascencio.com.mx']) {
      try {
        const res = await axios.get(`${host}/api/status`, { timeout: 3000 });
        console.log(`\n=== STATUS EN ${host}/api/status ===`);
        console.log(JSON.stringify(res.data, null, 2));
      } catch (e) {
        console.log(`\n=== ${host}/api/status NO RESPONDE: ${e.message} ===`);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
})();
