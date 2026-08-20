require('dotenv').config();
const { localQuery } = require('../src/localdb');

async function check() {
  try {
    const [rows] = await localQuery("SELECT id, entidad, clave_registro, datos, estado, error_msg, fecha_recepcion FROM webhook_logs ORDER BY id DESC LIMIT 5");
    console.log(rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
check();
