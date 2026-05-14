const db = require('./src/db');
db.query('SELECT * FROM Cambios ORDER BY id DESC LIMIT 5')
  .then(res => console.log(JSON.stringify(res[0], null, 2)))
  .catch(console.error)
  .finally(() => process.exit(0));
