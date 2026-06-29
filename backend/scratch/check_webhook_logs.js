require('dotenv').config();
const { localQuery } = require('../src/localdb');
const { query } = require('../src/db');

async function run() {
  try {
    console.log('--- Latest 3 entries in local webhook_logs ---');
    const [logs] = await localQuery('SELECT * FROM webhook_logs ORDER BY id DESC LIMIT 3');
    console.log(JSON.stringify(logs, null, 2));

    console.log('\n--- Current email in ERP clientes_email for Clave_Cliente = 1282 ---');
    const [emails] = await query('SELECT * FROM clientes_email WHERE Clave_Cliente = 1282');
    console.log(JSON.stringify(emails, null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}

run();
