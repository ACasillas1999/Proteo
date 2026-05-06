const { query } = require('../src/db');
(async () => {
  try {
    const [rows] = await query('SELECT * FROM Cambios LIMIT 10');
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
})();
