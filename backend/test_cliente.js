require('dotenv').config();
const { mapCliente } = require('./src/handlers/cliente');
const { query } = require('./src/db');

(async () => {
  try {
    const [rows] = await query('SELECT * FROM clientes LIMIT 1');
    if (!rows.length) { console.log('No hay clientes.'); process.exit(0); }
    
    console.log('=== Registro ERP (raw) ===');
    console.log(JSON.stringify(rows[0], null, 2));
    
    const payload = await mapCliente(rows[0]);
    
    console.log('\n=== JSON que se enviaría a POST /customers ===');
    console.log(JSON.stringify({ data: [payload] }, null, 2));
    
    console.log('\n✅ Prueba finalizada.');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
})();
