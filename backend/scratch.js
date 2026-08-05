require('dotenv').config();
const { localQuery } = require('./src/localdb');

(async () => {
  try {
    console.log('=== Buscando logs del pedido 113 (VIC00000101W) ===');
    const [rows] = await localQuery(
      "SELECT datos FROM webhook_logs WHERE entidad = 'orders' AND datos LIKE '%VIC00000101W%' LIMIT 1"
    );

    if (rows.length === 0) {
      console.log('No se encontraron logs para VIC00000101W');
      return;
    }

    const datosJson = typeof rows[0].datos === 'string' ? JSON.parse(rows[0].datos) : rows[0].datos;
    console.log(`Original StatusId: ${datosJson.StatusId || datosJson.order.StatusId}`);
    console.log(`Original StatusName: ${datosJson.StatusName || datosJson.order.StatusName}`);

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
})();
