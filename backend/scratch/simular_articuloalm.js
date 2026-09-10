'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { query } = require('../src/db');
const { mapArticuloalm, sync } = require('../src/handlers/articuloalm');
const ps = require('../src/powersales');

async function main() {
  const claveArticulo = process.argv[2];
  const almacen = process.argv[3];
  const shouldSend = process.argv.includes('--send');

  console.log('====================================================');
  console.log('   SIMULADOR Y PRUEBA DE SINCRONIZACIÓN ARTICULOALM ');
  console.log('====================================================\n');

  try {
    let rows;
    if (claveArticulo) {
      let sql = 'SELECT * FROM articuloalm WHERE Clave_Articulo = ?';
      let params = [claveArticulo];
      if (almacen) {
        sql += ' AND Almacen = ?';
        params.push(almacen);
      }
      [rows] = await query(sql, params);
      if (!rows.length) {
        console.error(`❌ No se encontró ningún registro en 'articuloalm' para Clave_Articulo: '${claveArticulo}'${almacen ? ` y Almacen: '${almacen}'` : ''}`);
        process.exit(1);
      }
    } else {
      console.log('ℹ️  No especificaste Clave_Articulo. Obteniendo una muestra de la tabla articuloalm...');
      [rows] = await query('SELECT * FROM articuloalm LIMIT 3');
      if (!rows.length) {
        console.error('❌ La tabla articuloalm en el ERP está vacía.');
        process.exit(1);
      }
    }

    console.log(`📋 Se encontraron ${rows.length} registro(s) en ERP para simular.\n`);

    const dataArr = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      console.log(`--- [ Registro #${index + 1} en ERP ] ---`);
      console.log('Fila original ERP:', row);

      const payload = await mapArticuloalm(row);
      console.log('\nPayload JSON generado según el mapeo actual:');
      console.dir(payload, { depth: null });
      console.log('-----------------------------------------\n');
      dataArr.push(payload);
    }

    const requestBody = { data: dataArr };

    if (!shouldSend) {
      console.log('💡 MODO SIMULACIÓN (DRY-RUN)');
      console.log('Cuerpo completo que se enviaría a PowerSales POST /warehouseinventory:');
      console.log(JSON.stringify(requestBody, null, 2));
      console.log('\n👉 Para enviar la petición REAL a PowerSales, ejecuta:');
      console.log(`   node scratch/simular_articuloalm.js ${claveArticulo || '<Clave_Articulo>'} ${almacen || ''} --send\n`);
    } else {
      console.log('🚀 ENVIANDO PETICIÓN REAL A POWERSALES (POST /warehouseinventory)...');
      console.log('URL Base:', process.env.PS_BASE_URL);
      console.log('Payload:', JSON.stringify(requestBody, null, 2));

      try {
        const response = await ps.post('/warehouseinventory', requestBody);
        console.log('\n✅ RESPUESTA EXITOSA DE POWERSALES:');
        console.log(`Status HTTP: ${response.status} ${response.statusText}`);
        console.log('Respuesta Body:', JSON.stringify(response.data, null, 2));
      } catch (err) {
        console.error('\n❌ ERROR RECIBIDO DE POWERSALES:');
        console.error(err.message);
      }
    }

  } catch (error) {
    console.error('❌ Error general en la simulación:', error);
  } finally {
    process.exit(0);
  }
}

main();
