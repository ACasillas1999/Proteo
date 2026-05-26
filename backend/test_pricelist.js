require('dotenv').config();
const { sync } = require('./src/handlers/articulo');
const ps = require('./src/powersales');

// Interceptamos la petición para no afectar producción y solo ver el JSON
ps.post = async (url, data) => {
  console.log(`\n=== Petición a: ${url} ===`);
  console.log(JSON.stringify(data, null, 2));
  return { data: { success: true } };
};

(async () => {
  try {
    const { query } = require('./src/db');
    // Tomamos el primer artículo que encontremos para la prueba
    const [rows] = await query('SELECT Clave_Articulo FROM articulo LIMIT 1');
    if (!rows.length) {
      console.log('No se encontraron artículos en la base de datos local.');
      process.exit(0);
    }
    
    const sku = rows[0].Clave_Articulo;
    console.log(`Generando JSON para el artículo: ${sku}...`);
    
    // Ejecutamos el flujo de sincronización tal cual lo haría el worker
    await sync({ clave_registro: sku });
    
    console.log('\n✅ Prueba finalizada exitosamente.');
  } catch (err) {
    console.error('Error durante la prueba:', err);
  } finally {
    process.exit(0);
  }
})();
