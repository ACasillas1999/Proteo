require('dotenv').config();
const { localQuery } = require('./src/localdb');

(async () => {
  try {
    const [rows] = await localQuery('SELECT datos FROM sync_history WHERE id = ?', [6693]);
    if (rows.length > 0) {
      console.log('Payload for 6693:');
      console.log(JSON.stringify(JSON.parse(rows[0].datos), null, 2));
    } else {
      console.log('Not found');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit(0);
  }
})();
