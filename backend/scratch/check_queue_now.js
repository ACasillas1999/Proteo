'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query } = require('../src/db');
const { localQuery } = require('../src/localdb');

(async () => {
  try {
    const [updCambios] = await query(
      `UPDATE Cambios
       SET sincronizado = 3,
           error_sync = 'Pedido local del ERP (no originado en PowerSales)'
       WHERE tabla = 'surtidopedido'
         AND sincronizado = 2
         AND error_sync LIKE '%"noInsert":["0"]%'`
    );
    console.log(`✓ Cambios actualizados de Error (2) a Local (3): ${updCambios.affectedRows}`);

    const [updHist] = await localQuery(
      `UPDATE sync_history
       SET estado = 3,
           error_msg = 'Pedido local del ERP (no originado en PowerSales)'
       WHERE entidad = 'surtidopedido'
         AND estado = 2
         AND error_msg LIKE '%"noInsert":["0"]%'`
    );
    console.log(`✓ sync_history actualizados de Error (2) a Local (3): ${updHist.affectedRows}`);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
