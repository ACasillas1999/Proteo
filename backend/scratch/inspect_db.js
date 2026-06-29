require('dotenv').config();
const { migrate, localQuery } = require('../src/localdb');

async function run() {
  try {
    console.log('Running migrate()...');
    await migrate();
    console.log('Migration finished successfully.');

    console.log('\n--- Checking local field_mapping for Email in cliente ---');
    const [rows] = await localQuery(`
      SELECT * FROM field_mapping 
      WHERE entity = 'cliente' AND ps_field = 'Email'
    `);
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}

run();
