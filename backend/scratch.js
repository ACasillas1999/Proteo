require('dotenv').config();
const { localQuery } = require('./src/localdb');
const { query } = require('./src/db');

(async () => {
  try {
    const [configRows] = await localQuery(
      "SELECT config_value FROM app_config WHERE `key` = 'pedido_detalle_table' LIMIT 1"
    );
    const detTable = configRows.length > 0 ? configRows[0].config_value : 'dbpedvta';
    console.log(`Tabla de detalles configurada: ${detTable}`);

    const [columns] = await query(`SHOW COLUMNS FROM \`${detTable}\``);
    console.log('Columnas de la tabla de detalles:');
    console.log(columns.map(c => `${c.Field} (${c.Type})`).join('\n'));

    // Busquemos un pedido reciente en dbpedvta para ver valores reales
    const [sampleRows] = await query(`SELECT * FROM \`${detTable}\` ORDER BY No_Pedido DESC LIMIT 5`);
    console.log('Muestras de filas en la tabla de detalles:');
    console.log(JSON.stringify(sampleRows, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
})();
