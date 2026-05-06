'use strict';
require('dotenv').config({ path: '../.env' });
const mysql = require('mysql2/promise');

async function test() {
  console.log('Testing DB connection to:', process.env.MYSQL_HOST);
  try {
    const connection = await mysql.createConnection({
      host:     process.env.MYSQL_HOST,
      port:     parseInt(process.env.MYSQL_PORT) || 3306,
      database: process.env.MYSQL_DB,
      user:     process.env.MYSQL_USER,
      password: process.env.MYSQL_PASS || '',
    });
    console.log('✓ Connection successful');
    
    const [rows] = await connection.execute('SHOW TABLES LIKE "Cambios"');
    if (rows.length > 0) {
      console.log('✓ Table "Cambios" exists');
    } else {
      console.error('✗ Table "Cambios" DOES NOT EXIST');
    }
    
    await connection.end();
  } catch (err) {
    console.error('✗ Connection failed:', err.message);
  }
}

test();
