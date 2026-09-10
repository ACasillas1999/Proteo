'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/db');

async function testTrigger5() {
  console.log('====================================================');
  console.log('   PRUEBA DE 5 DISPAROS (TRIGGERS) EN ARTICULOALM   ');
  console.log('====================================================\n');

  try {
    const [userRes] = await query('SELECT USER(), CURRENT_USER()');
    console.log('👤 Usuario MySQL actual:', userRes[0]);

    const [rows] = await query('SELECT Clave_Articulo, Almacen, Existencia_Fisica FROM articuloalm LIMIT 5');
    console.log(`\n📌 Se seleccionaron los siguientes ${rows.length} artículos para la prueba:`);
    console.table(rows);

    const [beforeCambios] = await query("SELECT MAX(id) as maxId FROM Cambios");
    const lastIdBefore = beforeCambios[0].maxId || 0;
    console.log(`\n📊 ÚLTIMO ID EN LA TABLA 'Cambios' ANTES DE LA PRUEBA: #${lastIdBefore}\n`);

    for (let i = 0; i < rows.length; i++) {
      const { Clave_Articulo, Almacen, Existencia_Fisica } = rows[i];
      const valOriginal = parseFloat(Existencia_Fisica) || 0;
      const valTemporal = valOriginal + 1;

      console.log(`--- [ Prueba #${i + 1} ] Artículo: '${Clave_Articulo}' | Almacén: '${Almacen}' ---`);

      // Modificar a valor temporal
      await query(
        'UPDATE articuloalm SET Existencia_Fisica = ? WHERE Clave_Articulo = CAST(? AS CHAR CHARACTER SET latin1) AND Almacen = CAST(? AS CHAR CHARACTER SET latin1)',
        [valTemporal, Clave_Articulo, Almacen]
      );

      // Restaurar valor original
      await query(
        'UPDATE articuloalm SET Existencia_Fisica = ? WHERE Clave_Articulo = CAST(? AS CHAR CHARACTER SET latin1) AND Almacen = CAST(? AS CHAR CHARACTER SET latin1)',
        [valOriginal, Clave_Articulo, Almacen]
      );

      // Verificar si se generaron registros en Cambios
      const [cambiosGenerados] = await query(
        'SELECT id, tabla, clave_registro, campos_modificados, fecha_cambio, sincronizado FROM Cambios WHERE tabla = "articuloalm" AND clave_registro = CAST(? AS CHAR CHARACTER SET latin1) ORDER BY id DESC LIMIT 2',
        [`${Clave_Articulo}|${Almacen}`]
      );

      console.log(`   ✓ Registros generados en 'Cambios' para '${Clave_Articulo}|${Almacen}': ${cambiosGenerados.length}`);
      if (cambiosGenerados.length > 0) {
        cambiosGenerados.forEach(c => {
          console.log(`     -> ID #${c.id} | Clave: ${c.clave_registro} | Campos: ${c.campos_modificados} | Fecha: ${c.fecha_cambio} | Sincronizado: ${c.sincronizado}`);
        });
      } else {
        console.log(`     ❌ NO se generó ninguna fila en Cambios para '${Clave_Articulo}|${Almacen}'!`);
      }
      console.log('');
    }

    const [afterCambios] = await query('SELECT id, tabla, clave_registro, campos_modificados, fecha_cambio, sincronizado FROM Cambios WHERE id > ? ORDER BY id ASC', [lastIdBefore]);
    console.log('====================================================');
    console.log(`📊 RESUMEN FINAL: Se insertaron ${afterCambios.length} registros en la tabla 'Cambios':`);
    console.table(afterCambios);

  } catch (err) {
    console.error('❌ Error ejecutando pruebas:', err);
  } finally {
    process.exit(0);
  }
}

testTrigger5();
