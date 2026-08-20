require('dotenv').config();
const { query } = require('../src/db');

async function check() {
  try {
    console.log('--- BUSCANDO VIC EN CBPEDVTA ---');
    const [pedidos] = await query(`SELECT No_Pedido, Distribuido, IDPs FROM cbpedvta WHERE IDPs LIKE '%VIC%' OR IDPs = 'VIC00000129W' OR IDPs = 'VIC00000128W' ORDER BY No_Pedido DESC LIMIT 10`);
    console.log('cbpedvta:', pedidos);

    console.log('\n--- BUSCANDO VIC EN CBCOT ---');
    const [cotiz] = await query(`SELECT No_Cotiza, IDPs FROM cbcot WHERE IDPs LIKE '%VIC%' OR IDPs = 'VIC00000129W' OR IDPs = 'VIC00000128W' ORDER BY No_Cotiza DESC LIMIT 10`);
    console.log('cbcot:', cotiz);

    console.log('\n--- ULTIMOS 5 REGISTROS DE CBPEDVTA ---');
    const [ultimos] = await query(`SELECT No_Pedido, Distribuido, IDPs FROM cbpedvta ORDER BY No_Pedido DESC LIMIT 5`);
    console.log('ultimos cbpedvta:', ultimos);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}

check();
