require('dotenv').config();
const { localQuery } = require('./src/localdb');

(async () => {
  try {
    const [rows] = await localQuery(
      'SELECT id, cambio_id, entidad, operacion, clave_registro, estado, error_msg, fecha_sync FROM sync_history WHERE estado = 1 ORDER BY fecha_sync DESC LIMIT 10'
    );
    console.log('Most recent successful syncs (estado = 1):');
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit(0);
  }
})();
