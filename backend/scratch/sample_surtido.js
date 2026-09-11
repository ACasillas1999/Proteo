require('dotenv').config();
const { query } = require('../src/db');
const surtidopedido = require('../src/handlers/surtidopedido');
const ps = require('../src/powersales');

(async () => {
  try {
    const [orders] = await query('SELECT No_Pedido, IDPs FROM cbpedvta LIMIT 1');
    if (!orders.length) {
      console.log('No hay pedidos en cbpedvta');
      process.exit(0);
    }
    const sampleOrder = orders[0];

    const cambio = {
      clave_registro: sampleOrder.No_Pedido,
      campos_modificados: 'FULLY_PICKED'
    };

    ps.post = async (path, body) => {
      console.log('\n=== PAYLOAD ENVIADO A POWERSALES ===');
      console.log(JSON.stringify(body.data, null, 2));
      return { data: { ok: 1 } };
    };

    await surtidopedido.sync(cambio);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
})();
