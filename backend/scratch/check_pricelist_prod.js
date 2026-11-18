'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const articuloHandler = require('../src/handlers/articulo');

(async () => {
  try {
    console.log('Probando sincronización de artículo 10220024200 hacia PowerSales...');
    const res = await articuloHandler.sync({ id: 1258, tabla: 'articulo', clave_registro: '10220024200' });
    console.log('✅ Sincronización exitosa de 10220024200:');
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('❌ Error al sincronizar 10220024200:', err.message);
    process.exit(1);
  }
})();
