require('dotenv').config();
const { mapCliente } = require('../src/handlers/cliente');
const { query } = require('../src/db');

async function run() {
  try {
    console.log('Finding a client that exists in both clientes and clientes_email with a non-empty email...');
    const [matches] = await query(`
      SELECT c.Cliente, ce.e_mail 
      FROM clientes c
      INNER JOIN clientes_email ce ON ce.Clave_Cliente = c.Cliente
      WHERE ce.e_mail IS NOT NULL AND ce.e_mail <> '' AND ce.e_mail <> ' '
      LIMIT 1
    `);

    if (matches.length === 0) {
      console.log('No client found with a non-empty email. Let\'s try to find any client.');
      const [anyClient] = await query('SELECT Cliente FROM clientes LIMIT 1');
      if (anyClient.length === 0) {
        console.log('No clients found at all.');
        process.exit(0);
      }
      const testId = anyClient[0].Cliente;
      console.log(`Using client ID ${testId} (will insert dummy email for testing)...`);
      await query(`
        INSERT INTO clientes_email (Clave_Cliente, e_mail) 
        VALUES (?, 'test_webhook@example.com')
        ON DUPLICATE KEY UPDATE e_mail = 'test_webhook@example.com'
      `, [testId]);
      matches.push({ Cliente: testId, e_mail: 'test_webhook@example.com' });
    }

    const testClientId = matches[0].Cliente;
    console.log(`Querying client ${testClientId} with LEFT JOIN to clientes_email...`);
    const [rows] = await query(
      `SELECT c.*, ce.e_mail AS e_mail 
       FROM clientes c
       LEFT JOIN clientes_email ce ON ce.Clave_Cliente = c.Cliente
       WHERE c.Cliente = ? 
       LIMIT 1`,
      [testClientId]
    );

    console.log('=== Raw Query Row ===');
    console.log(JSON.stringify({ ...rows[0], Razon_Social: rows[0].Razon_Social.substring(0, 30) + '...' }, null, 2));

    const payload = await mapCliente(rows[0]);
    console.log('\n=== Mapped Payload for PowerSales ===');
    console.log(JSON.stringify({ ...payload, Name: payload.Name.substring(0, 30) + '...' }, null, 2));
    console.log(`Email value: "${payload.Email}"`);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}

run();
