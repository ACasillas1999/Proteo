require('dotenv').config();
const { query } = require('./src/db');

async function run() {
  try {
    const [rows] = await query('SHOW COLUMNS FROM articuloalm');
    console.log(rows.map(r => r.Field));
  } catch (e) {
    console.error(e.message);
  }
  process.exit();
}
run();
