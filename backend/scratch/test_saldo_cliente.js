require('dotenv').config();
const { query } = require('../src/db');
const clienteHandler = require('../src/handlers/cliente');
const ps = require('../src/powersales');

(async () => {
  try {
    const [rows] = await query('SELECT Cliente, Razon_Social, Saldo_Actual, IdGlobal FROM clientes WHERE Saldo_Actual > 0 LIMIT 1');
    if (!rows.length) {
      console.log('No se encontraron clientes con Saldo_Actual > 0');
      process.exit(0);
    }

    const sample = rows[0];
    console.log('=== CLIENTE SELECCIONADO EN BD ===');
    console.log(`Cliente (ID): ${sample.Cliente}`);
    console.log(`Razón Social: ${sample.Razon_Social}`);
    console.log(`Saldo Actual: ${sample.Saldo_Actual}`);
    console.log(`IdGlobal:     ${sample.IdGlobal}`);

    // Mock ps.post para ver el JSON generado
    ps.post = async (path, body) => {
      console.log('\n=== PAYLOAD GENERADO PARA POWERSALES (POST /customers) ===');
      console.log(JSON.stringify(body.data, null, 2));
      return { data: { ok: 1 } };
    };

    const cambio = {
      tabla: 'clientes',
      clave_registro: sample.Cliente,
      campos_modificados: 'Saldo_Actual'
    };

    console.log('\n⚙️ Ejecutando clienteHandler.sync()...');
    await clienteHandler.sync(cambio);

  } catch (err) {
    console.error('❌ ERROR:', err);
  } finally {
    process.exit(0);
  }
})();
