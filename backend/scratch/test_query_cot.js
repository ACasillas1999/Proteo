'use strict';
require('dotenv').config();
const { query } = require('../src/db');

async function main() {
  try {
    const [res] = await query('SELECT No_Cotiza FROM cbcot WHERE IDPs = ? OR IDPs = ? LIMIT 1', ['COT123', '456']);
    console.log('Query result without error:', res);
  } catch (e) {
    console.error('Error en SELECT cbcot:', e.message);
  }
  process.exit(0);
}

main();
