require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query } = require('../src/db');

(async () => {
  try {
    // Buscar tablas que contengan "client"
    const [t1] = await query("SHOW TABLES");
    const allTables = t1.map(r => Object.values(r)[0]);
    const clientTables = allTables.filter(t => t.toLowerCase().includes('client'));
    console.log('=== Tablas con "client" ===');
    console.log(clientTables.length ? clientTables.join(', ') : '(ninguna)');

    // Intentar directamente con 'clientes'
    console.log('\n=== Intentando SHOW COLUMNS FROM clientes ===');
    const [cols] = await query('SHOW COLUMNS FROM clientes');
    for (const c of cols) {
      console.log(`  ${c.Field.padEnd(35)} ${c.Type.padEnd(20)} ${c.Key || ''}`);
    }

    const [sample] = await query('SELECT * FROM clientes LIMIT 1');
    if (sample.length) {
      console.log('\n=== EJEMPLO ===');
      console.log(JSON.stringify(sample[0], null, 2));
    }
  } catch (err) {
    console.error('Error:', err.message);
    
    // Fallback: buscar en todas las tablas
    try {
      const [t] = await query("SHOW TABLES");
      const all = t.map(r => Object.values(r)[0]);
      const matches = all.filter(t => 
        t.toLowerCase().includes('client') || 
        t.toLowerCase().includes('deudor') || 
        t.toLowerCase().includes('socio') ||
        t.toLowerCase().includes('kna')
      );
      console.log('\nTablas que podrían ser clientes:', matches.length ? matches.join(', ') : '(ninguna encontrada)');
      console.log('\nTodas las tablas:', all.join(', '));
    } catch (e2) {
      console.error('Error listando tablas:', e2.message);
    }
  } finally {
    process.exit(0);
  }
})();
