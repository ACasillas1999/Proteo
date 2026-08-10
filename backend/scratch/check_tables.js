require('dotenv').config({ path: '../.env' });
const { localQuery } = require('../src/localdb');

async function run() {
  try {
    const [rows] = await localQuery("SELECT id, clave_registro, estado, branch_id, fecha_recepcion FROM webhook_logs WHERE datos LIKE '%\"Id\":132,%' OR datos LIKE '%\"Id\":132}'");
    console.log('Webhook logs containing ID 132:', rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
