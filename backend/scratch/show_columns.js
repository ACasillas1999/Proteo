const { query } = require('../src/db');
(async () => {
  try {
    const [rows] = await query('SHOW COLUMNS FROM articulo');
    console.log(rows.map(r => r.Field));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
