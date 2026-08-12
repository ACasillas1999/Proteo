require('dotenv').config({ path: '../.env' });
const { getPool } = require('../src/db');

async function run() {
  try {
    const pool = getPool();
    const [rows1] = await pool.query("SELECT No_Pedido FROM cbpedvta WHERE CONVERT(IDPs USING utf8mb4) = 'TEST17156'");
    console.log('CONVERT query success:', rows1);

    const [rows2] = await pool.query("SELECT No_Pedido FROM cbpedvta WHERE IDPs = ? COLLATE utf8mb4_unicode_ci", ['TEST17156']);
    console.log('COLLATE query success:', rows2);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

run();
