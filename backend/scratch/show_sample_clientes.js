const { query } = require('../src/db');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

(async () => {
  try {
    const [rows] = await query('SELECT Cliente, Razon_Social, RFC FROM clientes LIMIT 5');
    console.log('=== Sample Clientes in ERP ===');
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error('Error fetching sample clientes:', err.message);
  } finally {
    process.exit(0);
  }
})();
