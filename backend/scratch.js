require('dotenv').config();
const { localQuery } = require('./src/localdb');

(async () => {
  try {
    const [rows] = await localQuery(
      "SELECT id, datos FROM webhook_logs WHERE entidad = 'orders' ORDER BY id DESC LIMIT 100"
    );
    for (const row of rows) {
      const datos = typeof row.datos === 'string' ? JSON.parse(row.datos) : row.datos;
      if (!datos) continue;
      const orderId = datos.order ? datos.order.Id : datos.Id;
      const orderNum = datos.order ? datos.order.OrderNumber : datos.OrderNumber;
      
      if (orderId && Number(orderId) === 12990) {
        console.log(`Encontrado!`);
        console.log(`Log ID: ${row.id}`);
        console.log(`Order ID: ${orderId}`);
        console.log(`OrderNumber (IPAD): ${orderNum}`);
        console.log('Datos completos:', JSON.stringify(datos, null, 2));
        process.exit(0);
      }
    }
    console.log('No se encontró el ID 12990 en los logs de webhooks recientes.');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
})();
