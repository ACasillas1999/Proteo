require('dotenv').config();
const { localQuery } = require('./src/localdb');

(async () => {
  try {
    console.log('=== Mapeos de pedido_detalle ===');
    const [rows] = await localQuery(
      "SELECT * FROM field_mapping WHERE entity = 'pedido_detalle'"
    );
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
})();
